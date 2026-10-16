"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useSession } from "next-auth/react";
import { toast } from "@/lib/toast";

export interface BadgeItem {
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  awardedAt?: string;
}

interface PinnedBadgesShowcaseProps {
  initialPinnedBadges: BadgeItem[];
  allEarnedBadges: BadgeItem[];
  isOwner: boolean;
  username: string;
}

export function PinnedBadgesShowcase({
  initialPinnedBadges,
  allEarnedBadges,
  isOwner,
  username,
}: PinnedBadgesShowcaseProps) {
  const { data: session } = useSession();
  const [pinnedBadges, setPinnedBadges] = useState<BadgeItem[]>(initialPinnedBadges);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>(
    initialPinnedBadges.map((b) => b.slug)
  );
  const [saving, setSaving] = useState(false);

  // If viewing someone else's profile and they have no pinned badges, hide showcase
  if (!isOwner && pinnedBadges.length === 0) {
    return null;
  }

  function toggleBadge(slug: string) {
    if (selectedSlugs.includes(slug)) {
      setSelectedSlugs(selectedSlugs.filter((s) => s !== slug));
    } else {
      if (selectedSlugs.length >= 3) {
        toast.error("You can pin a maximum of 3 badges");
        return;
      }
      setSelectedSlugs([...selectedSlugs, slug]);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const token = (session as any)?.apiToken;
      const res = await fetch("/api/users/me/pinned-badges", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ badgeIds: selectedSlugs }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message || "Failed to update pinned badges");
      }

      const updated = allEarnedBadges.filter((b) => selectedSlugs.includes(b.slug));
      setPinnedBadges(updated);
      setIsEditing(false);
      toast.success("Pinned badges updated!");
    } catch (err: any) {
      toast.error(err.message || "Failed to update pinned badges");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="via-background mb-8 overflow-hidden border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-amber-500/5 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">⭐</span>
            <CardTitle className="text-lg font-bold tracking-tight">Pinned Badges</CardTitle>
            <Badge
              variant="outline"
              className="border-amber-500/40 text-xs font-semibold text-amber-500"
            >
              Showcase
            </Badge>
          </div>
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedSlugs(pinnedBadges.map((b) => b.slug));
                setIsEditing(!isEditing);
              }}
            >
              {isEditing ? "Cancel" : pinnedBadges.length > 0 ? "Edit Pinned" : "+ Pin Badges"}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isEditing ? (
          <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--background)] p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--muted-foreground)]">
                Select up to 3 earned badges to feature at the top of your profile (
                {selectedSlugs.length}/3 selected)
              </p>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Showcase"}
              </Button>
            </div>

            {allEarnedBadges.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                You haven&apos;t earned any badges yet. Complete challenges to earn badges!
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {allEarnedBadges.map((badge) => {
                  const isSelected = selectedSlugs.includes(badge.slug);
                  return (
                    <div
                      key={badge.slug}
                      onClick={() => toggleBadge(badge.slug)}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-all ${
                        isSelected
                          ? "border-amber-500 bg-amber-500/10 shadow-sm"
                          : "border-[var(--border)] hover:border-amber-500/40"
                      }`}
                    >
                      {badge.iconUrl ? (
                        <Image
                          src={badge.iconUrl}
                          alt={badge.name}
                          width={36}
                          height={36}
                          className="h-9 w-9 flex-shrink-0 object-contain"
                        />
                      ) : (
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-sm">
                          🏆
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-[var(--foreground)]">
                          {badge.name}
                        </p>
                        <p className="truncate text-[10px] text-[var(--muted-foreground)]">
                          {badge.description}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="pointer-events-none h-4 w-4 rounded accent-amber-500"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : pinnedBadges.length === 0 ? (
          <div className="py-2 text-center">
            <p className="text-sm text-[var(--muted-foreground)]">
              No badges pinned yet. Highlight your favorite achievements!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {pinnedBadges.map((badge) => (
              <div
                key={badge.slug}
                className="bg-[var(--background)]/80 flex items-center gap-3.5 rounded-xl border border-amber-500/30 p-3.5 shadow-sm transition-transform hover:-translate-y-0.5"
              >
                {badge.iconUrl ? (
                  <Image
                    src={badge.iconUrl}
                    alt={badge.name}
                    width={44}
                    height={44}
                    className="h-11 w-11 flex-shrink-0 object-contain"
                  />
                ) : (
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-lg">
                    🏅
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-semibold text-[var(--foreground)]">
                    {badge.name}
                  </h4>
                  <p className="line-clamp-2 text-xs text-[var(--muted-foreground)]">
                    {badge.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
