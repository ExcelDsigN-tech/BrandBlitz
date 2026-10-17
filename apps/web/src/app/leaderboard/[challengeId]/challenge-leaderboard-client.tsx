"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  LiveGlobalLeaderboard,
  LeaderboardScope,
} from "@/components/leaderboard/live-global-leaderboard";
import { createApiClient, api } from "@/lib/api";
import type { LeaderboardEntry } from "@/lib/api";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  challengeId: string;
  initialEntries: LeaderboardEntry[];
  initialHasMore: boolean;
}

type LeaderboardWindow = "daily" | "weekly" | "all-time";

const WINDOW_OPTIONS: { value: LeaderboardWindow; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "all-time", label: "All-Time" },
];

export function ChallengeLeaderboardClient({ challengeId, initialEntries, initialHasMore }: Props) {
  const { data: session, status } = useSession();
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [window_, setWindow] = useState<LeaderboardWindow>("all-time");
  const [entries, setEntries] = useState<LeaderboardEntry[]>(initialEntries);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);
  const [friendsFailed, setFriendsFailed] = useState(false);

  const isLoggedIn = status === "authenticated";

  // Default scope+window matches the server-rendered page; anything else
  // (friends scope, or a non-default time window, #1006) refetches client-side.
  useEffect(() => {
    if (scope !== "friends" && window_ === "all-time") {
      setEntries(initialEntries);
      setHasMore(initialHasMore);
      setFriendsFailed(false);
      return;
    }

    if (scope === "friends" && !isLoggedIn) {
      setEntries([]);
      setHasMore(false);
      return;
    }

    const loadLeaderboard = async () => {
      setIsLoadingFriends(true);
      setFriendsFailed(false);
      try {
        const token = session?.apiToken;
        const client = token ? createApiClient(token) : api;
        const res = await client.get(
          `/leaderboard/${challengeId}?limit=50&scope=${scope}&window=${window_}`
        );
        const data: LeaderboardEntry[] = res.data.data || res.data.sessions || [];
        setEntries(data);
        setHasMore(Boolean(res.data.nextCursor));
      } catch {
        setFriendsFailed(true);
        setEntries([]);
        setHasMore(false);
      } finally {
        setIsLoadingFriends(false);
      }
    };

    void loadLeaderboard();
  }, [scope, window_, isLoggedIn, challengeId, initialEntries, initialHasMore, session?.apiToken]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-6 py-4">
        <div
          role="tablist"
          aria-label="Leaderboard scope"
          className="inline-flex items-center rounded-md bg-[var(--muted)] p-1"
        >
          <Button
            role="tab"
            aria-selected={scope === "global"}
            size="sm"
            variant={scope === "global" ? "default" : "ghost"}
            className="h-8"
            onClick={() => setScope("global")}
          >
            Global
          </Button>
          <Button
            role="tab"
            aria-selected={scope === "friends"}
            size="sm"
            variant={scope === "friends" ? "default" : "ghost"}
            className="h-8"
            onClick={() => setScope("friends")}
          >
            Friends
          </Button>
          <Button
            role="tab"
            aria-selected={scope === "teams"}
            size="sm"
            variant={scope === "teams" ? "default" : "ghost"}
            className="h-8"
            onClick={() => setScope("teams")}
          >
            Teams
          </Button>
        </div>

        <div
          role="tablist"
          aria-label="Leaderboard time window"
          className="inline-flex items-center rounded-md bg-[var(--muted)] p-1"
        >
          {WINDOW_OPTIONS.map((option) => (
            <Button
              key={option.value}
              role="tab"
              aria-selected={window_ === option.value}
              size="sm"
              variant={window_ === option.value ? "default" : "ghost"}
              className="h-8"
              onClick={() => setWindow(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        {scope === "friends" && !isLoggedIn && (
          <p className="text-sm text-[var(--muted-foreground)]">
            Sign in to view your friends leaderboard
          </p>
        )}
      </div>

      {scope === "teams" ? (
        isLoadingFriends ? (
          <div className="space-y-4 px-6 py-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="grid grid-cols-[80px_1fr_120px] items-center gap-4">
                <Skeleton className="h-5 w-10" />
                <Skeleton className="h-5 w-40" />
                <Skeleton className="ml-auto h-5 w-20" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No team scores yet"
              description="Join or create a team on this challenge to compete on the team leaderboard!"
              action={
                <Link href={`/challenge/${challengeId}`}>
                  <Button>Join or Create a Team</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto p-6">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase text-[var(--muted-foreground)]">
                <tr>
                  <th className="pb-3 pl-2">Rank</th>
                  <th className="pb-3">Team Name</th>
                  <th className="pb-3 text-center">Members</th>
                  <th className="pb-3 text-right">Avg Score</th>
                  <th className="pb-3 pr-2 text-right">Total Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {entries.map((entry: any, index) => {
                  const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : null;
                  return (
                    <tr key={entry.teamId || index} className="hover:bg-[var(--muted)]/50">
                      <td className="py-3 pl-2 font-medium">
                        {medal ? (
                          <span className="mr-1.5">{medal}</span>
                        ) : (
                          `#${entry.rank ?? index + 1}`
                        )}
                      </td>
                      <td className="py-3">
                        <div className="font-semibold text-[var(--foreground)]">
                          {entry.teamName || entry.username || "Team"}
                        </div>
                        {entry.members && entry.members.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {entry.members.slice(0, 4).map((m: any) => (
                              <span
                                key={m.userId}
                                className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]"
                              >
                                {m.displayName || m.username} ({m.score} pts)
                              </span>
                            ))}
                            {entry.members.length > 4 && (
                              <span className="text-[10px] text-[var(--muted-foreground)]">
                                +{entry.members.length - 4} more
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 text-center font-medium text-[var(--muted-foreground)]">
                        {entry.memberCount ?? "—"}
                      </td>
                      <td className="py-3 text-right text-[var(--muted-foreground)]">
                        {entry.avgScore !== undefined ? entry.avgScore : "—"}
                      </td>
                      <td className="py-3 pr-2 text-right font-bold text-[var(--foreground)]">
                        {entry.totalScore?.toLocaleString() ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : scope === "friends" && !isLoggedIn ? (
        <div className="p-6">
          <EmptyState
            title="Sign in to view friends"
            description="Log in with Google to see how your referred friends rank on this challenge."
            action={
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(`/leaderboard/${challengeId}`)}`}
              >
                <Button>Sign In</Button>
              </Link>
            }
          />
        </div>
      ) : scope === "friends" && isLoadingFriends ? (
        <div className="space-y-4 px-6 py-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="grid grid-cols-[80px_1fr_120px_120px] items-center gap-4">
              <Skeleton className="h-5 w-10" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-36" />
              </div>
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      ) : scope === "friends" && friendsFailed ? (
        <div className="p-6">
          <EmptyState
            title="Couldn't load friends leaderboard"
            description="We couldn't load your friends rankings right now. Please try again."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  const token = session?.apiToken;
                  const client = token ? createApiClient(token) : api;
                  setIsLoadingFriends(true);
                  setFriendsFailed(false);
                  client
                    .get(`/leaderboard/${challengeId}?limit=50&scope=friends`)
                    .then((res) => {
                      const data: LeaderboardEntry[] = res.data.data || res.data.sessions || [];
                      setEntries(data);
                      setHasMore(Boolean(res.data.nextCursor));
                      setFriendsFailed(false);
                    })
                    .catch(() => setFriendsFailed(true))
                    .finally(() => setIsLoadingFriends(false));
                }}
              >
                Try Again
              </Button>
            }
          />
        </div>
      ) : (
        <LiveGlobalLeaderboard
          initial={entries}
          initialHasMore={hasMore}
          challengeId={challengeId}
          scope={scope}
        />
      )}
    </div>
  );
}
