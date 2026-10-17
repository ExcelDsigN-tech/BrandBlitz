"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { formatScore } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/api";
import { useLiveLeaderboard } from "@/hooks/use-live-leaderboard";
import { triggerMilestoneCelebration } from "@/components/gamification/milestone-celebration";

export function LiveChallengeLeaderboard({
  challengeId,
  initial,
}: {
  challengeId: string;
  initial: LeaderboardEntry[];
}) {
  const { data: session } = useSession();
  const { entries } = useLiveLeaderboard({ challengeId, initial });
  const prevRankByUserRef = useRef<Map<string, number>>(new Map());
  const [changedUsers, setChangedUsers] = useState<Set<string>>(new Set());
  const celebratedMilestonesRef = useRef<Set<string>>(new Set());

  const rows = useMemo(() => {
    return entries.slice(0, 10).map((e) => {
      const userKey = e.userId ?? e.username;
      return { ...e, _key: userKey };
    });
  }, [entries]);

  useEffect(() => {
    const prev = prevRankByUserRef.current;
    const changed = new Set<string>();
    for (const row of rows) {
      const prevRank = prev.get(row._key);
      if (prevRank !== undefined && prevRank !== row.rank) changed.add(row._key);
      prev.set(row._key, row.rank);
    }
    if (changed.size === 0) return;
    setChangedUsers(changed);
    const t = window.setTimeout(() => setChangedUsers(new Set()), 600);
    return () => window.clearTimeout(t);
  }, [rows]);

  const userIdentifier =
    (session?.user as { id?: string; email?: string } | null)?.id ?? session?.user?.email;

  useEffect(() => {
    if (!userIdentifier || rows.length === 0) return;

    const myEntry = rows.find(
      (r) =>
        r.userId === userIdentifier ||
        r.username === (session?.user as { username?: string } | null)?.username ||
        r.displayName === session?.user?.name
    );

    if (!myEntry) return;

    // 1. Podium finish (rank <= 3)
    if (myEntry.rank && myEntry.rank <= 3) {
      const podiumEventKey = `podium:${challengeId}:${userIdentifier}:${myEntry.rank}`;
      let alreadyTriggered = false;
      try {
        alreadyTriggered = sessionStorage.getItem(`milestone:${podiumEventKey}`) === "true";
      } catch {
        // ignore
      }
      if (!celebratedMilestonesRef.current.has(podiumEventKey) && !alreadyTriggered) {
        celebratedMilestonesRef.current.add(podiumEventKey);
        try {
          sessionStorage.setItem(`milestone:${podiumEventKey}`, "true");
        } catch {
          // ignore
        }
        triggerMilestoneCelebration("podium", { rank: myEntry.rank });
      }
    }

    // 2. Personal best score
    const bestScoreKey = `pb:${challengeId}:${userIdentifier}`;
    let storedBest: string | null = null;
    try {
      storedBest = sessionStorage.getItem(`milestone:${bestScoreKey}`);
    } catch {
      // ignore
    }
    const previousScore = storedBest ? Number(storedBest) : null;

    if (myEntry.totalScore > 0) {
      if (previousScore !== null && myEntry.totalScore > previousScore) {
        const pbEventKey = `pb_event:${challengeId}:${userIdentifier}:${myEntry.totalScore}`;
        if (!celebratedMilestonesRef.current.has(pbEventKey)) {
          celebratedMilestonesRef.current.add(pbEventKey);
          try {
            sessionStorage.setItem(`milestone:${bestScoreKey}`, String(myEntry.totalScore));
          } catch {
            // ignore
          }
          triggerMilestoneCelebration("personal_best", { score: myEntry.totalScore });
        }
      } else if (previousScore === null) {
        try {
          sessionStorage.setItem(`milestone:${bestScoreKey}`, String(myEntry.totalScore));
        } catch {
          // ignore
        }
      }
    }
  }, [rows, userIdentifier, challengeId, session?.user]);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--border)]">
          <th className="px-6 py-3 text-left text-[var(--muted-foreground)]">Rank</th>
          <th className="px-6 py-3 text-left text-[var(--muted-foreground)]">Player</th>
          <th className="px-6 py-3 text-right text-[var(--muted-foreground)]">Score</th>
          <th className="px-6 py-3 text-right text-[var(--muted-foreground)]">Est. Payout</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => (
          <tr
            key={entry._key}
            className={[
              "border-b border-[var(--border)] transition-colors last:border-0",
              changedUsers.has(entry._key) ? "bg-[var(--muted)]" : "",
            ].join(" ")}
          >
            <td className="px-6 py-3 font-bold">#{entry.rank}</td>
            <td className="px-6 py-3">{entry.displayName ?? entry.username}</td>
            <td className="px-6 py-3 text-right font-mono">{formatScore(entry.totalScore)}</td>
            <td className="px-6 py-3 text-right text-green-600">{"—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
