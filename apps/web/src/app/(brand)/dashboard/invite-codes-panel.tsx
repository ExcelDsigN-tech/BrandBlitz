"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface InviteCode {
  id: string;
  code: string;
  challenge_id: string | null;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
}

export function InviteCodesPanel({
  brandId,
  apiToken,
  challenges,
}: {
  brandId: string;
  apiToken?: string;
  challenges: { id: string; status: string }[];
}) {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [challengeId, setChallengeId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!apiToken) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void createApiClient(apiToken)
      .get(`/brands/${brandId}/invite-codes`)
      .then((res) => {
        if (!cancelled) {
          setCodes(res.data.data ?? []);
          setCursor(res.data.nextCursor ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load invite codes.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, apiToken, attempt]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!apiToken || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await createApiClient(apiToken).post(`/brands/${brandId}/invite-codes`, {
        ...(challengeId ? { challengeId } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        ...(maxUses ? { maxUses: Number(maxUses) } : {}),
      });
      setCodes((previous) => [res.data.inviteCode, ...previous]);
    } catch {
      setError("Couldn't generate a code. Check the expiry and usage limit, then retry.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!apiToken || !cursor || busy) return;
    setBusy(true);
    try {
      const res = await createApiClient(apiToken).get(`/brands/${brandId}/invite-codes`, {
        params: { cursor },
      });
      setCodes((previous) => [...previous, ...res.data.data]);
      setCursor(res.data.nextCursor);
    } catch {
      setError("Couldn't load more codes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Priority invite codes" className="space-y-4">
      <h2 className="text-lg font-semibold">Priority invite codes</h2>
      <p className="text-sm text-[var(--muted-foreground)]">
        Give waitlisted players immediate access. Only the brand owner can manage codes.
      </p>
      {error && (
        <p role="alert">
          {error}{" "}
          <Button size="sm" variant="outline" onClick={() => setAttempt(attempt + 1)}>
            Refresh codes
          </Button>
        </p>
      )}
      <form onSubmit={generate} className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Scope
          <select
            aria-label="Invite scope"
            value={challengeId}
            onChange={(event) => setChallengeId(event.target.value)}
            className="mt-1 block rounded border bg-[var(--background)] p-2"
          >
            <option value="">Whole brand</option>
            {challenges.map((challenge) => (
              <option key={challenge.id} value={challenge.id}>
                {challenge.id.slice(0, 8)} ({challenge.status})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Expires (optional)
          <Input
            aria-label="Invite expiry"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>
        <label className="text-sm">
          Max uses (optional)
          <Input
            aria-label="Invite maximum uses"
            type="number"
            min="1"
            max="100000"
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : "Generate invite code"}
        </Button>
      </form>
      {loading ? (
        <p role="status">Loading invite codes…</p>
      ) : !codes.length ? (
        <p>No invite codes yet.</p>
      ) : (
        <ul className="space-y-3">
          {codes.map((code) => (
            <li key={code.id} className="rounded border border-[var(--border)] p-3">
              <code className="select-all break-all">{code.code}</code>
              <p className="text-sm">
                {code.use_count} / {code.max_uses ?? "Unlimited"} uses ·{" "}
                {code.challenge_id ? `Challenge ${code.challenge_id.slice(0, 8)}` : "Whole brand"}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {code.expires_at
                  ? `Expires ${new Date(code.expires_at).toLocaleString()}`
                  : "No expiry"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <Button variant="outline" disabled={busy} onClick={() => void loadMore()}>
          Load more codes
        </Button>
      )}
    </section>
  );
}
