"use client";

import { useState, useEffect, useCallback } from "react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CohortFilter {
  signup_source?: "referral" | "organic" | "";
  league?: "bronze" | "silver" | "gold" | "";
  status?: "active" | "suspended" | "";
  min_fraud_flags?: string;
  max_fraud_flags?: string;
  min_total_earned_usdc?: string;
  active_within_days?: string;
  created_after?: string;
  created_before?: string;
}

export interface CohortUser {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  role: string;
  status: string;
  league: string | null;
  total_score: number;
  total_earned_usdc: string;
  challenges_played: number;
  streak: number;
  last_active_at: string | null;
  created_at: string;
  fraud_flag_count: number;
}

interface SavedPreset {
  name: string;
  filter: CohortFilter;
}

const PRESETS_STORAGE_KEY = "admin_cohort_presets";
const DEFAULT_PRESETS: SavedPreset[] = [
  {
    name: "High-fraud users",
    filter: { min_fraud_flags: "3" },
  },
  {
    name: "Top earners",
    filter: { min_total_earned_usdc: "50" },
  },
  {
    name: "Referral sign-ups",
    filter: { signup_source: "referral" },
  },
  {
    name: "Inactive 30 days",
    filter: { active_within_days: "30", status: "active" },
  },
];

const EMPTY_FILTER: CohortFilter = {
  signup_source: "",
  league: "",
  status: "",
  min_fraud_flags: "",
  max_fraud_flags: "",
  min_total_earned_usdc: "",
  active_within_days: "",
  created_after: "",
  created_before: "",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function filterToParams(filter: CohortFilter): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (v !== "" && v !== undefined) params[k] = String(v);
  }
  return params;
}

function buildQueryString(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CohortBuilderProps {
  apiToken: string;
}

export function CohortBuilder({ apiToken }: CohortBuilderProps) {
  const [filter, setFilter] = useState<CohortFilter>({ ...EMPTY_FILTER });
  const [results, setResults] = useState<CohortUser[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Load presets from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
      setPresets(stored ? (JSON.parse(stored) as SavedPreset[]) : DEFAULT_PRESETS);
    } catch {
      setPresets(DEFAULT_PRESETS);
    }
  }, []);

  function savePresetsToStorage(updated: SavedPreset[]) {
    try {
      localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // localStorage may be unavailable; silently continue
    }
    setPresets(updated);
  }

  function applyPreset(preset: SavedPreset) {
    setFilter({ ...EMPTY_FILTER, ...preset.filter });
    setResults(null);
    setTotal(null);
    setNextCursor(null);
    setError(null);
  }

  function saveAsPreset() {
    const name = presetName.trim();
    if (!name) return;
    const updated = [...presets.filter((p) => p.name !== name), { name, filter }];
    savePresetsToStorage(updated);
    setPresetName("");
    setSavingPreset(false);
  }

  function deletePreset(name: string) {
    savePresetsToStorage(presets.filter((p) => p.name !== name));
  }

  const runQuery = useCallback(
    async (cursorOverride?: string) => {
      setLoading(true);
      setError(null);
      try {
        const api = createApiClient(apiToken);
        const params = {
          ...filterToParams(filter),
          limit: "20",
          ...(cursorOverride ? { cursor: cursorOverride } : {}),
        };
        const { data } = await api.get<{
          users: CohortUser[];
          total: number;
          nextCursor: string | null;
        }>(`/admin/users/cohort?${buildQueryString(params)}`);
        setResults((prev) =>
          cursorOverride ? [...(prev ?? []), ...data.users] : data.users
        );
        setTotal(data.total);
        setNextCursor(data.nextCursor);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to run cohort query."
        );
      } finally {
        setLoading(false);
      }
    },
    [apiToken, filter]
  );

  async function downloadCsv() {
    setDownloading(true);
    try {
      const api = createApiClient(apiToken);
      const params = filterToParams(filter);
      const response = await api.get(
        `/admin/users/cohort/export?${buildQueryString(params)}`,
        { responseType: "blob" }
      );
      const blob = new Blob([response.data as BlobPart], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cohort-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  }

  function updateFilter(field: keyof CohortFilter, value: string) {
    setFilter((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Cohort Builder</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Saved presets ── */}
        <section aria-labelledby="presets-heading">
          <h3 id="presets-heading" className="mb-2 text-sm font-medium">
            Saved presets
          </h3>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <div key={preset.name} className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(preset)}
                  className="h-7 text-xs"
                >
                  {preset.name}
                </Button>
                <button
                  type="button"
                  aria-label={`Delete preset ${preset.name}`}
                  className="text-[var(--muted-foreground)] hover:text-red-500 text-xs leading-none"
                  onClick={() => deletePreset(preset.name)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ── Filters ── */}
        <section aria-labelledby="filters-heading">
          <h3 id="filters-heading" className="mb-3 text-sm font-medium">
            Filters
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Signup source */}
            <div className="space-y-1">
              <Label htmlFor="signup_source">Signup source</Label>
              <select
                id="signup_source"
                value={filter.signup_source ?? ""}
                onChange={(e) => updateFilter("signup_source", e.target.value)}
                className="block w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="">Any</option>
                <option value="referral">Referral</option>
                <option value="organic">Organic</option>
              </select>
            </div>

            {/* League */}
            <div className="space-y-1">
              <Label htmlFor="league">League</Label>
              <select
                id="league"
                value={filter.league ?? ""}
                onChange={(e) => updateFilter("league", e.target.value)}
                className="block w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="">Any</option>
                <option value="bronze">Bronze</option>
                <option value="silver">Silver</option>
                <option value="gold">Gold</option>
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <Label htmlFor="user_status">Account status</Label>
              <select
                id="user_status"
                value={filter.status ?? ""}
                onChange={(e) => updateFilter("status", e.target.value)}
                className="block w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="">Any</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>

            {/* Min fraud flags */}
            <div className="space-y-1">
              <Label htmlFor="min_fraud_flags">Min fraud flags</Label>
              <Input
                id="min_fraud_flags"
                type="number"
                min={0}
                placeholder="e.g. 1"
                value={filter.min_fraud_flags ?? ""}
                onChange={(e) => updateFilter("min_fraud_flags", e.target.value)}
              />
            </div>

            {/* Max fraud flags */}
            <div className="space-y-1">
              <Label htmlFor="max_fraud_flags">Max fraud flags</Label>
              <Input
                id="max_fraud_flags"
                type="number"
                min={0}
                placeholder="e.g. 10"
                value={filter.max_fraud_flags ?? ""}
                onChange={(e) => updateFilter("max_fraud_flags", e.target.value)}
              />
            </div>

            {/* Min earned USDC */}
            <div className="space-y-1">
              <Label htmlFor="min_total_earned_usdc">Min earned USDC</Label>
              <Input
                id="min_total_earned_usdc"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 10"
                value={filter.min_total_earned_usdc ?? ""}
                onChange={(e) => updateFilter("min_total_earned_usdc", e.target.value)}
              />
            </div>

            {/* Active within N days */}
            <div className="space-y-1">
              <Label htmlFor="active_within_days">Active within (days)</Label>
              <Input
                id="active_within_days"
                type="number"
                min={1}
                max={365}
                placeholder="e.g. 30"
                value={filter.active_within_days ?? ""}
                onChange={(e) => updateFilter("active_within_days", e.target.value)}
              />
            </div>

            {/* Created after */}
            <div className="space-y-1">
              <Label htmlFor="created_after">Created after</Label>
              <Input
                id="created_after"
                type="date"
                value={filter.created_after?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  updateFilter(
                    "created_after",
                    e.target.value ? `${e.target.value}T00:00:00Z` : ""
                  )
                }
              />
            </div>

            {/* Created before */}
            <div className="space-y-1">
              <Label htmlFor="created_before">Created before</Label>
              <Input
                id="created_before"
                type="date"
                value={filter.created_before?.slice(0, 10) ?? ""}
                onChange={(e) =>
                  updateFilter(
                    "created_before",
                    e.target.value ? `${e.target.value}T23:59:59Z` : ""
                  )
                }
              />
            </div>
          </div>
        </section>

        {/* ── Actions ── */}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void runQuery()} disabled={loading}>
            {loading ? "Running…" : "Run query"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setFilter({ ...EMPTY_FILTER });
              setResults(null);
              setTotal(null);
              setNextCursor(null);
              setError(null);
            }}
          >
            Clear
          </Button>
          {total !== null && (
            <Button
              variant="outline"
              onClick={() => void downloadCsv()}
              disabled={downloading || total === 0}
              aria-label="Export cohort to CSV"
            >
              {downloading ? "Exporting…" : `Export CSV (${total.toLocaleString()})`}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSavingPreset((s) => !s)}
          >
            Save as preset
          </Button>
        </div>

        {/* ── Save preset inline form ── */}
        {savingPreset && (
          <div className="flex items-center gap-2">
            <Input
              placeholder="Preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              className="max-w-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveAsPreset();
                if (e.key === "Escape") setSavingPreset(false);
              }}
            />
            <Button size="sm" onClick={saveAsPreset} disabled={!presetName.trim()}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSavingPreset(false)}>
              Cancel
            </Button>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {/* ── Results ── */}
        {results !== null && (
          <section aria-labelledby="results-heading">
            <div className="mb-3 flex items-center justify-between">
              <h3 id="results-heading" className="text-sm font-medium">
                Results{" "}
                {total !== null && (
                  <span className="font-normal text-[var(--muted-foreground)]">
                    — {total.toLocaleString()} user{total !== 1 ? "s" : ""} matched
                  </span>
                )}
              </h3>
            </div>

            {results.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No users matched the current filters.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-[var(--muted)] text-left text-xs font-medium text-[var(--muted-foreground)]">
                      <th className="px-3 py-2">Display name</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">League</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Earned (USDC)</th>
                      <th className="px-3 py-2 text-right">Challenges</th>
                      <th className="px-3 py-2 text-right">Fraud flags</th>
                      <th className="px-3 py-2">Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((u) => (
                      <tr key={u.id} className="border-b last:border-0 hover:bg-[var(--muted)]/40">
                        <td className="px-3 py-2 font-medium">{u.display_name}</td>
                        <td className="px-3 py-2 text-[var(--muted-foreground)]">{u.email}</td>
                        <td className="px-3 py-2 capitalize">{u.league ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              u.status === "suspended"
                                ? "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
                                : "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
                            }
                          >
                            {u.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {Number(u.total_earned_usdc).toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">{u.challenges_played}</td>
                        <td className="px-3 py-2 text-right">
                          {u.fraud_flag_count > 0 ? (
                            <span className="font-semibold text-red-600">
                              {u.fraud_flag_count}
                            </span>
                          ) : (
                            0
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--muted-foreground)]">
                          {u.last_active_at
                            ? new Date(u.last_active_at).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {nextCursor && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={loading}
                onClick={() => void runQuery(nextCursor)}
              >
                Load more
              </Button>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
