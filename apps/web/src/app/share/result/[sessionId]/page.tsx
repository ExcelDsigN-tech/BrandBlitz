import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatScore } from "@/lib/format";

interface PageProps {
  params: Promise<{ sessionId: string }>;
}

interface ShareCard {
  sessionId: string;
  challengeId: string;
  brandName: string;
  totalScore: number;
  rank: number | null;
  completedAt: string;
  player: {
    displayName: string | null;
    username: string | null;
  };
}

async function getShareCard(sessionId: string): Promise<ShareCard | null> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost/api";
    const res = await fetch(`${apiUrl}/sessions/${sessionId}/share-card`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sessionId } = await params;
  const card = await getShareCard(sessionId);

  if (!card) {
    return { title: "Result Not Found" };
  }

  const player = card.player.displayName ?? card.player.username ?? "A player";
  const title = `${player} scored ${formatScore(card.totalScore)} on ${card.brandName}`;
  const description = card.rank
    ? `Ranked #${card.rank} on this BrandBlitz challenge.`
    : "Check out this BrandBlitz challenge result.";
  const ogImageUrl = `/api/og/result/${sessionId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function SharedResultPage({ params }: PageProps) {
  const { sessionId } = await params;
  const card = await getShareCard(sessionId);

  if (!card) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <EmptyState title="Result not found" description="This result card is unavailable." />
      </div>
    );
  }

  const player = card.player.displayName ?? card.player.username ?? "A player";

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="text-2xl">{card.brandName} Challenge</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-6xl font-bold text-[var(--primary)]">
              {formatScore(card.totalScore)}
            </p>
            <p className="mt-1 text-[var(--muted-foreground)]">points</p>
          </div>

          {card.rank && <p className="text-lg font-medium">Rank #{card.rank}</p>}

          <p className="text-sm text-[var(--muted-foreground)]">{player}&apos;s result</p>

          <div className="flex flex-col gap-3">
            <Button asChild variant="secondary" className="w-full">
              <Link href={`/leaderboard/${card.challengeId}`}>Challenge Leaderboard</Link>
            </Button>
            <Button asChild className="w-full">
              <Link href="/">Play BrandBlitz</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
