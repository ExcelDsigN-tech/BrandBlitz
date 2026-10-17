"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { formatUsdc } from "@/lib/format";
import { EscrowTopUpModal } from "@/components/brand/escrow-topup-modal";

export interface EscrowChallenge {
  id: string;
  status: string;
  poolAmountUsdc: string;
  stats?: { total_paid_out_usdc: number };
}

interface EscrowPanelProps {
  brandId: string;
  challenges: EscrowChallenge[];
  apiToken?: string;
  initialBudgetThreshold?: number | string | null;
  budgetAlertSent?: boolean;
}

function poolNumber(challenge: EscrowChallenge): number {
  const parsed = Number.parseFloat(challenge.poolAmountUsdc);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Remaining scheduled payouts: full pool for challenges still awaiting a
 * deposit, plus any active challenge pool not yet paid out. Doubles as the
 * suggested top-up amount for the funding modal (issue #1039).
 */
export function remainingScheduledPayouts(challenges: EscrowChallenge[]): number {
  return challenges.reduce((total, challenge) => {
    if (challenge.status === "pending_deposit") {
      return total + poolNumber(challenge);
    }
    if (challenge.status === "active") {
      const paid = challenge.stats?.total_paid_out_usdc ?? 0;
      return total + Math.max(0, poolNumber(challenge) - paid);
    }
    return total;
  }, 0);
}

/**
 * Escrow status panel with a one-click top-up shortcut (issue #1039)
 * and configurable spend budget alert threshold (issue #1003).
 */
export function EscrowPanel({
  brandId,
  challenges,
  apiToken,
  initialBudgetThreshold,
  budgetAlertSent: initialBudgetAlertSent = false,
}: EscrowPanelProps) {
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [budgetThreshold, setBudgetThreshold] = useState<number | string | null>(
    initialBudgetThreshold ?? null
  );
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [thresholdInput, setThresholdInput] = useState(
    initialBudgetThreshold !== null && initialBudgetThreshold !== undefined
      ? String(initialBudgetThreshold)
      : ""
  );
  const [savingBudget, setSavingBudget] = useState(false);
  const [alertSent, setAlertSent] = useState(initialBudgetAlertSent);

  const pendingDeposit = useMemo(
    () => challenges.find((c) => c.status === "pending_deposit") ?? null,
    [challenges]
  );
  const remaining = useMemo(() => remainingScheduledPayouts(challenges), [challenges]);
  const shortfall = useMemo(
    () =>
      challenges
        .filter((c) => c.status === "active")
        .reduce((sum, c) => {
          const paid = c.stats?.total_paid_out_usdc ?? 0;
          return sum + Math.max(0, poolNumber(c) - paid);
        }, 0),
    [challenges]
  );

  const status = pendingDeposit
    ? { label: "Awaiting deposit", variant: "secondary" as const }
    : shortfall > 0
      ? { label: "Below scheduled payouts", variant: "destructive" as const }
      : { label: "Covered", variant: "outline" as const };

  const parsedThreshold =
    budgetThreshold !== null && budgetThreshold !== undefined && budgetThreshold !== ""
      ? Number(budgetThreshold)
      : null;
  const isBelowThreshold =
    parsedThreshold !== null && !isNaN(parsedThreshold) && remaining < parsedThreshold;

  async function handleSaveBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!apiToken) return;
    setSavingBudget(true);
    try {
      const val = thresholdInput.trim() === "" ? null : Number(thresholdInput);
      const res = await fetch(`/api/brands/${brandId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({ budget_threshold: val }),
      });
      if (!res.ok) throw new Error("Failed to save threshold");
      setBudgetThreshold(val);
      setAlertSent(false);
      setIsEditingBudget(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingBudget(false);
    }
  }

  return (
    <CardContent className="space-y-4 border-t border-[var(--border)] pt-4">
      {(isBelowThreshold || alertSent) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold">⚠️ Low Budget Warning:</span>
            <span>
              Remaining escrow ({formatUsdc(remaining)}) is below your configured threshold (
              {parsedThreshold !== null ? formatUsdc(parsedThreshold) : "—"}).
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={() => setTopUpOpen(true)}>
            Top Up Escrow
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">Escrow</span>
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className="text-[var(--muted-foreground)]">
            Remaining scheduled payouts:{" "}
            <span className="font-semibold text-[var(--foreground)]">{formatUsdc(remaining)}</span>
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">
            • Budget alert threshold:{" "}
            <span className="font-medium text-[var(--foreground)]">
              {parsedThreshold !== null ? formatUsdc(parsedThreshold) : "None"}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setThresholdInput(parsedThreshold !== null ? String(parsedThreshold) : "");
              setIsEditingBudget(!isEditingBudget);
            }}
          >
            {isEditingBudget ? "Cancel" : "Set Alert Threshold"}
          </Button>
          <Button size="sm" onClick={() => setTopUpOpen(true)} aria-label="Top up escrow">
            Top Up
          </Button>
        </div>
      </div>

      {isEditingBudget && (
        <form
          onSubmit={handleSaveBudget}
          className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3"
        >
          <span className="text-xs font-medium text-[var(--muted-foreground)]">
            Alert when balance drops below (USDC):
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            placeholder="e.g. 50"
            className="h-8 w-28 rounded-md border border-[var(--border)] bg-transparent px-2 text-sm text-[var(--foreground)]"
          />
          <Button size="sm" type="submit" disabled={savingBudget}>
            {savingBudget ? "Saving..." : "Save"}
          </Button>
        </form>
      )}

      <EscrowTopUpModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        apiToken={apiToken}
        challengeId={pendingDeposit?.id ?? null}
        brandId={brandId}
        suggestedAmount={remaining}
      />
    </CardContent>
  );
}
