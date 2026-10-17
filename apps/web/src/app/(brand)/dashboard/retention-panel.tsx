"use client";

import { useEffect, useState } from "react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Cell {
  cohort_week: string;
  cohort_size: number;
  week_offset: number;
  retained_users: number;
  retention_pct: number;
}

export function RetentionPanel({ brandId, apiToken }: { brandId: string; apiToken?: string }) {
  const [data, setData] = useState<{ challengeCount: number; cohorts: Cell[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!apiToken) return;
    let cancelled = false;
    setFailed(false);
    setData(null);
    void createApiClient(apiToken)
      .get(`/brands/${brandId}/retention`)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, apiToken, attempt]);

  const weeks = [...new Set(data?.cohorts?.map((cell) => cell.cohort_week) ?? [])];
  const maxOffset = Math.max(0, ...(data?.cohorts?.map((cell) => cell.week_offset) ?? []));

  return (
    <section aria-label="Cohort retention" className="space-y-3">
      <h2 className="text-lg font-semibold">Cohort retention</h2>
      <p className="text-sm text-[var(--muted-foreground)]">
        Cohorts start with a player&apos;s first participation week (Monday, UTC). Later weeks count
        players returning to a different challenge. The current week is partial; up to 12 weeks are
        shown.
      </p>
      {failed ? (
        <div role="alert">
          Couldn&apos;t load retention.{" "}
          <Button variant="outline" size="sm" onClick={() => setAttempt(attempt + 1)}>
            Retry retention
          </Button>
        </div>
      ) : !data ? (
        <p role="status">Loading retention…</p>
      ) : data.challengeCount < 2 ? (
        <p>Launch at least two challenges to see retention.</p>
      ) : !weeks.length ? (
        <p>Retention will appear once players participate.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Percentage of each cohort returning by week since first participation
            </caption>
            <thead>
              <tr>
                <th scope="col" className="p-2 text-left">
                  Cohort / players
                </th>
                {Array.from({ length: maxOffset + 1 }, (_, offset) => (
                  <th scope="col" className="p-2" key={offset}>
                    Week {offset}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => {
                const cells = data.cohorts.filter((cell) => cell.cohort_week === week);
                return (
                  <tr key={week}>
                    <th scope="row" className="whitespace-nowrap p-2 text-left">
                      {week} / {cells[0].cohort_size}
                    </th>
                    {Array.from({ length: maxOffset + 1 }, (_, offset) => {
                      const cell = cells.find((item) => item.week_offset === offset);
                      return (
                        <td
                          key={offset}
                          className="p-2 text-center"
                          style={
                            cell
                              ? {
                                  backgroundColor: `rgba(99, 102, 241, ${cell.retention_pct / 250})`,
                                }
                              : undefined
                          }
                          title={
                            cell
                              ? `${cell.retained_users} of ${cell.cohort_size} players`
                              : "Week not reached"
                          }
                        >
                          {cell ? `${cell.retention_pct}%` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
