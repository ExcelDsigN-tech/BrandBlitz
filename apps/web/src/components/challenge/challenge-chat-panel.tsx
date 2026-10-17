"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface ChatMessageItem {
  id: string;
  challengeId: string;
  userId: string;
  username: string;
  displayName: string;
  content: string;
  timestamp: number;
  isSystem?: boolean;
}

interface ChallengeChatPanelProps {
  challengeId: string;
  apiToken?: string;
  currentUserId?: string;
  currentUsername?: string;
  challengeStatus?: string;
  isLoggedIn?: boolean;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "closed";

export function ChallengeChatPanel({
  challengeId,
  apiToken,
  currentUserId,
  currentUsername,
  challengeStatus = "active",
  isLoggedIn = true,
}: ChallengeChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [inputText, setInputText] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [participantCount, setParticipantCount] = useState<number>(1);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!apiToken || !isLoggedIn) {
      setStatus("disconnected");
      return;
    }

    if (challengeStatus !== "active") {
      setStatus("closed");
      return;
    }

    let isMounted = true;

    function connectWs() {
      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host =
          process.env.NEXT_PUBLIC_WS_URL ||
          process.env.NEXT_PUBLIC_API_URL?.replace(/^https?:\/\//, "") ||
          window.location.host;
        const cleanHost = host.replace(/\/api\/?$/, "");
        const wsUrl = `${protocol}//${cleanHost}/api/challenges/${challengeId}/chat?token=${encodeURIComponent(
          apiToken!
        )}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          setStatus("connected");
          setErrorBanner(null);
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);

            if (data.type === "connected") {
              if (typeof data.count === "number") {
                setParticipantCount(data.count);
              }
            } else if (data.type === "history") {
              if (Array.isArray(data.messages)) {
                setMessages(data.messages);
              }
            } else if (data.type === "chat" && data.message) {
              setMessages((prev) => [...prev, data.message]);
            } else if (data.type === "user_joined") {
              if (typeof data.count === "number") {
                setParticipantCount(data.count);
              }
              setMessages((prev) => [
                ...prev,
                {
                  id: `system-join-${Date.now()}-${Math.random()}`,
                  challengeId,
                  userId: "system",
                  username: data.username,
                  displayName: data.displayName || data.username,
                  content: `${data.displayName || data.username} joined the chat`,
                  timestamp: Date.now(),
                  isSystem: true,
                },
              ]);
            } else if (data.type === "user_left") {
              if (typeof data.count === "number") {
                setParticipantCount(data.count);
              }
            } else if (data.type === "challenge_ended") {
              setStatus("closed");
              setErrorBanner("Challenge has ended. Chat is closed.");
              setMessages((prev) => [
                ...prev,
                {
                  id: `system-end-${Date.now()}`,
                  challengeId,
                  userId: "system",
                  username: "system",
                  displayName: "System",
                  content: "Challenge has ended. Chat room is now closed.",
                  timestamp: Date.now(),
                  isSystem: true,
                },
              ]);
            } else if (data.type === "error") {
              setErrorBanner(data.message || "Chat error occurred");
              setTimeout(() => setErrorBanner(null), 4000);
            }
          } catch {
            // Ignore non-json frames
          }
        };

        ws.onerror = () => {
          if (!isMounted) return;
          setErrorBanner("Unable to connect to live chat.");
        };

        ws.onclose = (event) => {
          if (!isMounted) return;
          wsRef.current = null;
          if (event.code === 1000 || challengeStatus !== "active") {
            setStatus("closed");
          } else {
            setStatus("disconnected");
            // Attempt auto-reconnect after 3s if still mounted
            reconnectTimeoutRef.current = setTimeout(() => {
              if (isMounted) connectWs();
            }, 3000);
          }
        };
      } catch (err) {
        setStatus("disconnected");
      }
    }

    connectWs();

    return () => {
      isMounted = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounted");
        wsRef.current = null;
      }
    };
  }, [challengeId, apiToken, isLoggedIn, challengeStatus]);

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    if (trimmed.length > 280) {
      setErrorBanner("Message exceeds 280 characters.");
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setErrorBanner("Chat is not connected.");
      return;
    }

    try {
      wsRef.current.send(
        JSON.stringify({
          type: "chat",
          content: trimmed,
        })
      );
      setInputText("");
      setErrorBanner(null);
    } catch {
      setErrorBanner("Failed to send message.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="w-full rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 backdrop-blur-md shadow-lg overflow-hidden transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 bg-[var(--muted)]/30">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Live Challenge Chat</span>
          {status === "connected" && (
            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
              🟢 {participantCount} online
            </Badge>
          )}
          {status === "connecting" && (
            <Badge variant="outline" className="text-xs text-[var(--muted-foreground)]">
              Connecting...
            </Badge>
          )}
          {status === "closed" && (
            <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600 border-red-500/30">
              Closed
            </Badge>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? "Expand ▲" : "Collapse ▼"}
        </Button>
      </div>

      {!isCollapsed && (
        <>
          {/* Error Banner */}
          {errorBanner && (
            <div className="bg-red-500/10 border-b border-red-500/20 px-3 py-1.5 text-xs text-red-600 font-medium">
              {errorBanner}
            </div>
          )}

          {/* Messages list */}
          <div className="h-64 overflow-y-auto p-4 space-y-3 text-sm">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-xs text-[var(--muted-foreground)]">
                <p>No messages yet.</p>
                <p className="mt-1">Say hello to other challenge participants!</p>
              </div>
            ) : (
              messages.map((m) => {
                if (m.isSystem) {
                  return (
                    <div key={m.id} className="text-center text-[11px] text-[var(--muted-foreground)] italic py-1">
                      {m.content}
                    </div>
                  );
                }

                const isMe =
                  (currentUserId && m.userId === currentUserId) ||
                  (currentUsername && m.username === currentUsername);

                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] mb-0.5">
                      <span className="font-semibold text-[var(--foreground)]">
                        {isMe ? "You" : m.displayName || m.username}
                      </span>
                      <span>•</span>
                      <span>
                        {new Date(m.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs break-words shadow-sm ${
                        isMe
                          ? "bg-[var(--primary)] text-white"
                          : "bg-[var(--muted)] text-[var(--foreground)]"
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input field */}
          <form
            onSubmit={handleSendMessage}
            className="flex items-center gap-2 border-t border-[var(--border)] p-3 bg-[var(--background)]/60"
          >
            <div className="relative flex-1">
              <input
                type="text"
                placeholder={
                  status === "closed"
                    ? "Chat closed (challenge ended)"
                    : !isLoggedIn
                    ? "Log in to chat"
                    : "Type a message (max 280 chars)..."
                }
                value={inputText}
                maxLength={280}
                disabled={status !== "connected"}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)] disabled:opacity-50"
              />
              {inputText.length > 200 && (
                <span className="absolute right-2 top-1.5 text-[10px] text-[var(--muted-foreground)]">
                  {inputText.length}/280
                </span>
              )}
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={status !== "connected" || !inputText.trim()}
              className="h-8 px-3 text-xs"
            >
              Send
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
