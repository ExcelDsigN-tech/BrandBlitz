"use client";

import { useEffect, useState } from "react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";

const DEFAULT_WEIGHTS = { speed: 0.4, accuracy: 0.4, streak: 0.2 };

type Weights = typeof DEFAULT_WEIGHTS;

export function LeagueScoringPanel({ brandId, apiToken }: { brandId: string; apiToken?: string }) {
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!apiToken) return;
    void createApiClient(apiToken).get(`/leagues/brand/${brandId}`).then((response) => {
      const league = response.data.leagues?.[0];
      if (league) {
        setLeagueId(league.id);
        setWeights(league.scoring_weights);
      }
    });
  }, [apiToken, brandId]);

  const total = weights.speed + weights.accuracy + weights.streak;
  const valid = Math.abs(total - 1) < 0.001;

  async function save() {
    if (!apiToken || !valid) return;
    const api = createApiClient(apiToken);
    const body = { name: "Default league", scoringWeights: weights };
    if (leagueId) {
      await api.patch(`/leagues/${leagueId}`, body);
    } else {
      const response = await api.post("/leagues", { brandId, ...body });
      setLeagueId(response.data.league.id);
    }
    setMessage("Saved. Current standings were recalculated.");
  }

  return (
    <section className="mb-6 rounded-lg border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">League scoring</h3>
          <p className="text-xs text-[var(--muted-foreground)]">Weights must total 100%.</p>
        </div>
        <Button size="sm" onClick={() => void save()} disabled={!valid || !apiToken}>Save weights</Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {(["speed", "accuracy", "streak"] as const).map((factor) => (
          <label key={factor} className="text-sm capitalize">
            <span className="flex justify-between"><span>{factor}</span><span>{Math.round(weights[factor] * 100)}%</span></span>
            <input
              className="mt-2 w-full accent-[var(--primary)]"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={weights[factor]}
              onChange={(event) => setWeights((current) => ({ ...current, [factor]: Number(event.target.value) }))}
              aria-label={`${factor} weight`}
            />
          </label>
        ))}
      </div>
      {!valid && <p className="mt-2 text-xs text-red-600">Adjust the sliders so the total is 100%.</p>}
      {message && <p className="mt-2 text-xs text-[var(--muted-foreground)]">{message}</p>}
      <p className="mt-2 text-xs text-amber-700">Changing weights recalculates current and historical standings.</p>
    </section>
  );
}
