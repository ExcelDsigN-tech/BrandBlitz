"use client";

import { useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

interface ChallengeItem {
  id: string;
  status: string;
  poolAmountUsdc: string;
}

interface OgPreviewCardProps {
  brandName: string;
  brandLogoUrl?: string;
  primaryColor?: string;
  challenges: ChallengeItem[];
}

export function OgPreviewCard({
  brandName,
  brandLogoUrl,
  primaryColor,
  challenges,
}: OgPreviewCardProps) {
  const [selectedChallengeId, setSelectedChallengeId] = useState<string>(
    challenges[0]?.id ?? "preview"
  );
  const [copied, setCopied] = useState(false);

  // Construct OG preview image URL
  const ogImageUrl =
    selectedChallengeId === "preview"
      ? `/api/og/challenge/preview?brand_name=${encodeURIComponent(
          brandName
        )}&primary_color=${encodeURIComponent(primaryColor ?? "#0f172a")}${
          brandLogoUrl ? `&logo_url=${encodeURIComponent(brandLogoUrl)}` : ""
        }&pool_amount=100`
      : `/api/og/challenge/${selectedChallengeId}`;

  const shareUrl =
    selectedChallengeId === "preview"
      ? typeof window !== "undefined"
        ? window.location.origin
        : "https://brandblitz.gg"
      : typeof window !== "undefined"
        ? `${window.location.origin}/challenge/${selectedChallengeId}`
        : `https://brandblitz.gg/challenge/${selectedChallengeId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({
        title: "Link copied!",
        description: "Challenge share link copied to clipboard.",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Please copy the link manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="border-[var(--border)]">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Social Share Preview (Open Graph)</CardTitle>
            <CardDescription>
              Custom branded preview card shown on Twitter/X, Discord, LinkedIn, and messaging apps (#1022).
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {challenges.length > 1 && (
              <select
                aria-label="Select challenge to preview"
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-xs text-[var(--foreground)]"
                value={selectedChallengeId}
                onChange={(e) => setSelectedChallengeId(e.target.value)}
              >
                {challenges.map((c, idx) => (
                  <option key={c.id} value={c.id}>
                    Challenge #{idx + 1} ({c.status.replace("_", " ")})
                  </option>
                ))}
              </select>
            )}
            <Button size="sm" variant="outline" onClick={handleCopyLink}>
              {copied ? "Copied!" : "Copy Share Link"}
            </Button>
            <a href={ogImageUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="ghost">
                Open Image ↗
              </Button>
            </a>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative aspect-[1200/630] w-full max-w-2xl overflow-hidden rounded-xl border border-[var(--border)] bg-black/40 shadow-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ogImageUrl}
            alt={`${brandName} Social Preview`}
            className="h-full w-full object-cover transition-opacity duration-300"
            loading="lazy"
          />
        </div>
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">
          Rendered at 1200×630 using your brand kit palette ({primaryColor ?? "#0f172a"}), logo, and live prize pool.
        </p>
      </CardContent>
    </Card>
  );
}
