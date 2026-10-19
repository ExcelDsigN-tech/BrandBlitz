import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatUsdc } from "@/lib/format";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

interface PublicBrandProfile {
  brand: {
    id: string;
    name: string;
    logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    tagline: string | null;
    brand_story: string | null;
    usp: string | null;
    created_at: string;
  };
  challenges: {
    id: string;
    status: string;
    pool_amount_usdc: string;
    participant_count: number;
    starts_at: string;
    ends_at: string | null;
  }[];
  stats: {
    total_challenges: number;
    total_payout_usdc: number;
    avg_rating: number | null;
    rating_count: number;
  };
}

interface BrandProfilePageProps {
  params: Promise<{ id: string }>;
}

async function getBrandProfile(
  id: string
): Promise<{ profile: PublicBrandProfile | null; failed: boolean }> {
  try {
    const res = await fetch(`${API_URL}/brands/${id}/public`, {
      next: { revalidate: 60, tags: [`brand-${id}`] },
    });
    if (res.status === 404) return { profile: null, failed: false };
    if (!res.ok) throw new Error("Failed to fetch brand profile");
    return { profile: (await res.json()) as PublicBrandProfile, failed: false };
  } catch {
    return { profile: null, failed: true };
  }
}

export async function generateMetadata({ params }: BrandProfilePageProps): Promise<Metadata> {
  const { id } = await params;
  const { profile } = await getBrandProfile(id);
  if (!profile) return { title: "Brand Not Found" };
  const title = `${profile.brand.name} — Brand Profile`;
  const description =
    profile.brand.tagline ??
    `Explore ${profile.brand.name}'s challenges and brand story on BrandBlitz.`;
  return { title, description, alternates: { canonical: `/brands/${id}` } };
}

const STATUS_LABELS: Record<string, string> = {
  active: "Live",
  ended: "Awaiting payout",
  settled: "Settled",
  payout_failed: "Payout issue",
};

export default async function BrandProfilePage({ params }: BrandProfilePageProps) {
  const { id } = await params;
  const { profile, failed } = await getBrandProfile(id);

  if (failed) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <EmptyState
          title="Couldn't load this brand"
          description="We couldn't load this brand right now. Please try again."
          action={
            <Link href={`/brands/${id}`}>
              <Button variant="outline">Try Again</Button>
            </Link>
          }
        />
      </main>
    );
  }

  if (!profile) notFound();

  const { brand, challenges, stats } = profile;
  const activeChallenges = challenges.filter((c) => c.status === "active");
  const pastChallenges = challenges.filter((c) => c.status !== "active");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8 flex items-center gap-6">
        {brand.logo_url ? (
          <Image
            src={brand.logo_url}
            alt={brand.name}
            width={80}
            height={80}
            sizes="80px"
            className="h-20 w-20 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-[var(--primary)] text-2xl font-bold text-white">
            {brand.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-3xl font-bold">{brand.name}</h1>
          {brand.tagline && <p className="mt-1 text-[var(--muted-foreground)]">{brand.tagline}</p>}
        </div>
      </header>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="text-center">
          <CardContent className="pb-4 pt-6">
            <p className="text-2xl font-bold text-[var(--primary)]">{stats.total_challenges}</p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Challenges</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="pb-4 pt-6">
            <p className="text-2xl font-bold text-[var(--primary)]">
              {formatUsdc(stats.total_payout_usdc)}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Total prizes paid</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="pb-4 pt-6">
            <p className="text-2xl font-bold text-[var(--primary)]">
              {stats.avg_rating != null ? `${stats.avg_rating.toFixed(1)} / 5` : "—"}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Avg. difficulty
              {stats.rating_count > 0 ? ` (${stats.rating_count})` : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {(brand.brand_story || brand.usp) && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>About {brand.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {brand.brand_story && <p>{brand.brand_story}</p>}
            {brand.usp && (
              <p className="text-[var(--muted-foreground)]">
                <span className="font-medium text-[var(--foreground)]">What sets them apart: </span>
                {brand.usp}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">Active challenges</h2>
        {activeChallenges.length === 0 ? (
          <EmptyState
            title="No active challenges"
            description={`${brand.name} has no live challenges right now. Check back soon.`}
          />
        ) : (
          <div className="space-y-3">
            {activeChallenges.map((challenge) => (
              <ChallengeRow key={challenge.id} challenge={challenge} />
            ))}
          </div>
        )}
      </section>

      {pastChallenges.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-semibold">Past challenges</h2>
          <div className="space-y-3">
            {pastChallenges.map((challenge) => (
              <ChallengeRow key={challenge.id} challenge={challenge} past />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function ChallengeRow({
  challenge,
  past = false,
}: {
  challenge: PublicBrandProfile["challenges"][number];
  past?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <Badge variant={challenge.status === "active" ? "default" : "secondary"}>
            {STATUS_LABELS[challenge.status] ?? challenge.status}
          </Badge>
          <span className="text-sm font-medium">
            {formatUsdc(challenge.pool_amount_usdc)} prize pool
          </span>
          <span className="text-sm text-[var(--muted-foreground)]">
            {challenge.participant_count} player
            {challenge.participant_count === 1 ? "" : "s"}
          </span>
        </div>
        <Link href={`/challenge/${challenge.id}`}>
          <Button size="sm" variant={past ? "outline" : "default"}>
            {past ? "View results" : "Play now"}
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
