"use client";

import { useState } from "react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ChallengeRatingPromptProps {
  challengeId: string;
  apiToken?: string;
}

const RATING_LABELS: Record<number, string> = {
  1: "Very easy",
  2: "Easy",
  3: "About right",
  4: "Hard",
  5: "Very hard",
};

/**
 * Post-completion prompt asking the participant how difficult the challenge
 * was. Submitted once per user per challenge; failures are silent so the
 * result screen is never blocked (issue #999).
 */
export function ChallengeRatingPrompt({ challengeId, apiToken }: ChallengeRatingPromptProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!apiToken || dismissed) return null;

  async function submit(difficulty: number) {
    if (!apiToken || submitting) return;
    setSelected(difficulty);
    setSubmitting(true);
    try {
      const api = createApiClient(apiToken);
      await api.post(`/challenges/${challengeId}/rate`, { difficulty }, { skipErrorToast: true });
      setSubmitted(true);
    } catch {
      // Rating is best-effort — do not interrupt the result screen.
      setSelected(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="mx-auto w-full max-w-sm text-center">
        <CardContent className="pt-6">
          <p role="status" className="text-sm font-medium text-green-700">
            Thanks! Your rating helps brands improve future challenges.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-sm text-center">
      <CardHeader>
        <CardTitle className="text-base">How hard was this challenge?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-center gap-2" role="group" aria-label="Challenge difficulty">
          {[1, 2, 3, 4, 5].map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={selected === value ? "default" : "outline"}
              aria-label={`${value} — ${RATING_LABELS[value]}`}
              disabled={submitting}
              onClick={() => void submit(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">
          {selected ? RATING_LABELS[selected] : "1 = very easy · 5 = very hard"}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={() => setDismissed(true)}
        >
          Skip
        </Button>
      </CardContent>
    </Card>
  );
}
