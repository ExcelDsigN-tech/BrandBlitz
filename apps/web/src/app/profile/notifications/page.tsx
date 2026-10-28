"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { createApiClient } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface NotificationPreference {
  id: string;
  user_id: string;
  category: "payout" | "badge" | "streak" | "referral";
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, { label: string; description: string }> = {
  payout: {
    label: "Payout Notifications",
    description: "Get notified when you receive USDC payouts from challenges",
  },
  badge: {
    label: "Badge Notifications",
    description: "Get notified when you earn new badges",
  },
  streak: {
    label: "Streak Notifications",
    description: "Get notified when you hit streak milestones",
  },
  referral: {
    label: "Referral Notifications",
    description: "Get notified about referral bonuses and referrer activity",
  },
};

export default function NotificationPreferencesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;

  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated" || !apiToken) return;

    const loadPreferences = async () => {
      try {
        const api = createApiClient(apiToken);
        const response = await api.get("/users/me/notification-preferences");
        setPreferences(response.data.preferences);
      } catch (error) {
        console.error("Failed to load notification preferences", error);
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, [status, apiToken]);

  const handleToggle = async (category: string, newState: boolean) => {
    if (!apiToken) return;

    setSaving(category);
    try {
      const api = createApiClient(apiToken);
      const response = await api.patch(`/users/me/notification-preferences/${category}`, {
        enabled: newState,
      });

      setPreferences((prev) =>
        prev.map((p) => (p.category === category ? response.data.preference : p))
      );
    } catch (error) {
      console.error(`Failed to update ${category} notification preference`, error);
    } finally {
      setSaving(null);
    }
  };

  if (status !== "authenticated") return null;

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="text-center">Loading notification preferences...</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold">Notification Preferences</h1>
        <p className="text-[var(--muted-foreground)]">
          Choose which types of notifications you'd like to receive
        </p>
      </div>

      <div className="space-y-4">
        {preferences.map((pref) => {
          const label = CATEGORY_LABELS[pref.category];
          if (!label) return null;

          return (
            <Card key={pref.category}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{label.label}</h3>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {label.description}
                    </p>
                  </div>
                  <Button
                    variant={pref.enabled ? "default" : "outline"}
                    onClick={() => handleToggle(pref.category, !pref.enabled)}
                    disabled={saving === pref.category}
                    className="w-24"
                  >
                    {saving === pref.category ? "..." : pref.enabled ? "Enabled" : "Disabled"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="bg-[var(--muted)]/30 mt-8 rounded-lg border border-[var(--border)] p-4">
        <p className="text-sm text-[var(--muted-foreground)]">
          <strong>Note:</strong> Your preferences are saved automatically when you toggle each
          option. Disabling a notification type will prevent those messages from appearing in your
          notification bell and as toasts.
        </p>
      </div>
    </main>
  );
}
