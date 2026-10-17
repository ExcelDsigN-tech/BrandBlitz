"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createApiClient } from "@/lib/api";

export interface GalleryTemplate {
  id: string;
  brand_id: string;
  brand_name: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  pool_amount_usdc: string;
  ends_at: string | null;
  gallery_opted_in_at: string;
  completed_sessions: number;
  avg_score: number;
  completion_rate_pct: number;
  unique_participants: number;
}

interface GalleryTemplateSelectorProps {
  templates: GalleryTemplate[];
  apiToken: string;
  /** Brand id to clone into — the signed-in user's active brand. */
  brandId: string;
  poolAmountUsdc: string;
}

/**
 * Renders a grid of gallery templates the brand can clone.
 * Calls POST /challenge-templates/:id/clone on selection.
 */
export function GalleryTemplateSelector({
  templates,
  apiToken,
  brandId,
  poolAmountUsdc,
}: GalleryTemplateSelectorProps) {
  const router = useRouter();
  const [cloning, setCloningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClone(templateId: string) {
    setError(null);
    setCloningId(templateId);
    try {
      const api = createApiClient(apiToken);
      const { data } = await api.post<{
        challenge: { id: string };
        clonedFrom: { brandName: string };
        depositInstructions: { memo: string; amount: string };
      }>(`/challenge-templates/${templateId}/clone`, {
        brandId,
        poolAmountUsdc,
      });
      // Navigate to the newly created challenge's deposit page
      router.push(`/brand/${brandId}?cloned=${data.challenge.id}`);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to clone template. Please try again.";
      setError(msg);
      setCloningId(null);
    }
  }

  if (templates.length === 0) {
    return (
      <p className="text-center text-[var(--muted-foreground)] py-8">
        No gallery templates are available yet. Check back after more challenges complete.
      </p>
    );
  }

  return (
    <div>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      <ul
        className="grid gap-4 sm:grid-cols-2"
        aria-label="Gallery templates"
      >
        {templates.map((t) => (
          <li key={t.id}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="flex flex-col gap-3 p-5">
                {/* Brand identity */}
                <div className="flex items-center gap-3">
                  {t.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.logo_url}
                      alt={`${t.brand_name} logo`}
                      className="h-10 w-10 rounded-full object-contain border border-[var(--border)]"
                    />
                  ) : (
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                      style={{ backgroundColor: t.primary_color ?? "#6366f1" }}
                      aria-hidden="true"
                    >
                      {t.brand_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-semibold leading-tight">{t.brand_name}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {t.pool_amount_usdc} USDC pool
                    </p>
                  </div>
                </div>

                {/* Performance stats */}
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-[var(--muted)] px-2 py-1">
                    <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                      Completions
                    </dt>
                    <dd className="text-sm font-semibold">{t.completed_sessions}</dd>
                  </div>
                  <div className="rounded-md bg-[var(--muted)] px-2 py-1">
                    <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                      Avg score
                    </dt>
                    <dd className="text-sm font-semibold">{Math.round(t.avg_score)}</dd>
                  </div>
                  <div className="rounded-md bg-[var(--muted)] px-2 py-1">
                    <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                      Completion
                    </dt>
                    <dd className="text-sm font-semibold">{Math.round(t.completion_rate_pct)}%</dd>
                  </div>
                </dl>

                <Button
                  variant="outline"
                  className="mt-auto w-full"
                  disabled={cloning !== null}
                  aria-label={`Clone template from ${t.brand_name}`}
                  onClick={() => handleClone(t.id)}
                >
                  {cloning === t.id ? "Cloning…" : "Use this template"}
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
