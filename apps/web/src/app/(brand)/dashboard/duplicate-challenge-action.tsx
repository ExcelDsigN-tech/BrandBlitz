"use client";

import { useState, type FormEvent } from "react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DuplicateChallengeAction({
  challengeId,
  status,
  apiToken,
  onUpdated,
}: {
  challengeId: string;
  status: string;
  apiToken?: string;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [message, setMessage] = useState("");
  const [deposit, setDeposit] = useState<{
    hotWalletAddress: string;
    memo: string;
    amount: string;
  } | null>(null);

  async function duplicate() {
    if (!apiToken || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await createApiClient(apiToken).post(`/challenges/${challengeId}/duplicate`);
      onUpdated();
    } catch {
      setMessage("Couldn't duplicate this challenge. Only its owner can duplicate it.");
    } finally {
      setBusy(false);
    }
  }

  async function schedule(event: FormEvent) {
    event.preventDefault();
    if (!apiToken || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await createApiClient(apiToken).post(`/challenges/${challengeId}/publish-draft`, {
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      setDeposit(res.data.depositInstructions);
      setEditing(false);
    } catch {
      setMessage("Couldn't schedule this draft. Choose future dates at least one hour apart.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="sm" variant="outline" onClick={() => void duplicate()} disabled={busy}>
        Duplicate
      </Button>
      {status === "draft" && !deposit && (
        <Button size="sm" variant="outline" onClick={() => setEditing(!editing)} disabled={busy}>
          Set dates &amp; fund
        </Button>
      )}
      {editing && (
        <form onSubmit={schedule} className="min-w-64 space-y-2 rounded border p-3">
          <label className="block">
            Start date
            <Input
              aria-label="Draft start date"
              type="datetime-local"
              required
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </label>
          <label className="block">
            End date
            <Input
              aria-label="Draft end date"
              type="datetime-local"
              required
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </label>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Saving…" : "Save dates & get funding instructions"}
          </Button>
        </form>
      )}
      {deposit && (
        <div role="status" className="max-w-xs whitespace-normal break-all text-left">
          <p>
            Send exactly {deposit.amount} USDC to {deposit.hotWalletAddress}.
          </p>
          <p>
            Memo: <code>{deposit.memo}</code>
          </p>
          <Button size="sm" variant="outline" onClick={onUpdated}>
            Done
          </Button>
        </div>
      )}
      {message && (
        <p role="alert" className="max-w-xs whitespace-normal">
          {message}
        </p>
      )}
    </div>
  );
}
