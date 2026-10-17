"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient } from "@/lib/api";
import {
  NotificationToast,
  type Notification,
  type NotificationType,
} from "@/components/ui/notification-toast";

const ICONS: Record<NotificationType, string> = {
  payout_received: "💸",
  badge_earned: "🏅",
  streak_milestone: "🔥",
  rank_overtaken: "📉",
};

const TYPE_LABELS: Record<NotificationType, string> = {
  payout_received: "Payout received",
  badge_earned: "Badge earned",
  streak_milestone: "Streak milestone",
  rank_overtaken: "Rank drop",
};

function notificationSummary(n: Notification): string {
  switch (n.type) {
    case "payout_received": {
      const amount = n.payload.amount_usdc as string | undefined;
      return amount ? `You received ${amount} USDC` : "USDC payout received";
    }
    case "badge_earned": {
      const badge = n.payload.badge_name as string | undefined;
      return badge ? `Badge earned: ${badge}` : "New badge earned";
    }
    case "streak_milestone": {
      const days = n.payload.milestone as number | undefined;
      return days ? `${days}-day streak reached` : "Streak milestone reached";
    }
    case "rank_overtaken": {
      const rank = n.payload.new_rank as number | undefined;
      const name = n.payload.challenge_name as string | undefined;
      if (rank && name) return `You dropped to #${rank} on ${name}`;
      if (rank) return `You dropped to rank #${rank}`;
      return "You've been overtaken on the leaderboard";
    }
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString();
}

const POLL_INTERVAL_MS = 30_000;

interface NotificationBellProps {
  apiToken: string;
}

export function NotificationBell({ apiToken }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toastQueue, setToastQueue] = useState<Notification[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);
  const seenIds = useRef<Set<string>>(new Set());
  const drawerRef = useRef<HTMLDivElement>(null);

  const [statusFeedback, setStatusFeedback] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const api = createApiClient(apiToken);
      const res = await api.get<{ notifications: Notification[] }>("/users/me/notifications", {
        skipErrorToast: true,
      });
      const incoming = res.data.notifications;
      setNotifications(incoming);

      const newOnes = incoming.filter((n) => !n.read_at && !seenIds.current.has(n.id));
      if (newOnes.length > 0) {
        setToastQueue((prev) => [
          ...prev,
          ...newOnes.filter((n) => !prev.some((p) => p.id === n.id)),
        ]);
        newOnes.forEach((n) => seenIds.current.add(n.id));
      }
    } catch {
      // silently swallow — bell is non-critical
    }
  }, [apiToken]);

  useEffect(() => {
    void fetchNotifications();
    const interval = setInterval(() => void fetchNotifications(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    if (!drawerOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [drawerOpen]);

  const markRead = useCallback(
    async (id: string) => {
      try {
        const api = createApiClient(apiToken);
        await api.patch(`/users/me/notifications/${id}/read`, {}, { skipErrorToast: true });
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
        );
      } catch {
        // best-effort
      }
    },
    [apiToken]
  );

  const markAllRead = useCallback(async () => {
    try {
      const api = createApiClient(apiToken);
      await api.patch("/users/me/notifications/read-all", {}, { skipErrorToast: true });
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
      setStatusFeedback({ message: "All notifications marked as read", type: "success" });
    } catch {
      setStatusFeedback({ message: "Failed to mark notifications as read", type: "error" });
    } finally {
      setTimeout(() => setStatusFeedback(null), 3000);
    }
  }, [apiToken]);

  const dismissToast = useCallback(
    (id: string) => {
      setToastQueue((prev) => prev.filter((n) => n.id !== id));
      void markRead(id);
    },
    [markRead]
  );

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <>
      {/* Toast queue — fixed top-right */}
      <div className="pointer-events-none fixed right-4 top-20 z-50 flex flex-col gap-2">
        {toastQueue.map((n) => (
          <div key={n.id} className="pointer-events-auto">
            <NotificationToast notification={n} onDismiss={dismissToast} />
          </div>
        ))}
      </div>

      {/* Bell button */}
      <div className="relative" ref={drawerRef}>
        <button
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          onClick={() => setDrawerOpen((prev) => !prev)}
          className="relative flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-[var(--muted)]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--primary)] text-[10px] font-bold leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {/* Inbox drawer */}
        {drawerOpen && (
          <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold">Notifications</h2>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-[var(--primary)] hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            {statusFeedback && (
              <div
                role="status"
                className={`border-b px-4 py-1.5 text-center text-xs font-medium ${
                  statusFeedback.type === "success"
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400"
                }`}
              >
                {statusFeedback.message}
              </div>
            )}

            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">
                  No notifications yet
                </p>
              ) : (
                notifications.slice(0, visibleCount).map((n) => (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 border-b border-[var(--border)] px-4 py-3 transition-colors last:border-0 ${
                      !n.read_at ? "bg-[var(--primary)]/5" : ""
                    }`}
                  >
                    <span className="mt-0.5 text-lg leading-none">{ICONS[n.type]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--muted-foreground)]">
                        {TYPE_LABELS[n.type]}
                      </p>
                      <p className="truncate text-sm text-[var(--foreground)]">
                        {notificationSummary(n)}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {formatTime(n.created_at)}
                      </p>
                    </div>
                    {!n.read_at && (
                      <button
                        aria-label="Mark as read"
                        onClick={() => void markRead(n.id)}
                        className="mt-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {notifications.length > 0 && (
              <div className="bg-[var(--muted)]/20 flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
                {notifications.length > visibleCount ? (
                  <>
                    <span>
                      Showing {Math.min(visibleCount, notifications.length)} of{" "}
                      {notifications.length}
                    </span>
                    <button
                      onClick={() => setVisibleCount((prev) => prev + 5)}
                      className="font-medium text-[var(--primary)] hover:underline focus:outline-none"
                    >
                      Load older
                    </button>
                  </>
                ) : (
                  <span className="w-full py-0.5 text-center">
                    {notifications.length >= 50
                      ? "Showing 50 most recent notifications"
                      : "All notifications loaded"}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
