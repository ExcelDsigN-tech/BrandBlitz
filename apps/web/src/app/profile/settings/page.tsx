"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ProfileSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const token = (session as { apiToken?: string } | null)?.apiToken;
  const [timezone, setTimezone] = useState("UTC");
  const [accessibilityMode, setAccessibilityMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (!token) return;
    void createApiClient(token)
      .get("/users/me", { skipErrorToast: true })
      .then(({ data }) => {
        setTimezone(
          data.user?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
        );
        setAccessibilityMode(Boolean(data.user?.accessibility_mode));
      });
  }, [token]);

  async function save() {
    if (!token) return;
    setSaving(true);
    setMessage(null);
    try {
      await createApiClient(token).patch("/users/me/preferences", {
        timezone,
        accessibilityMode,
      });
      setMessage("Preferences saved.");
    } catch {
      setMessage("Could not save preferences.");
    } finally {
      setSaving(false);
    }
  }

  if (status !== "authenticated") return null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold">Profile settings</h1>
      <p className="mb-8 text-[var(--muted-foreground)]">
        Choose how challenge times and gameplay controls are presented.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Accessibility and time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Timezone</span>
            <input
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2"
              aria-describedby="timezone-help"
            />
            <span id="timezone-help" className="text-xs text-[var(--muted-foreground)]">
              Use an IANA timezone such as Africa/Niamey or America/New_York.
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={accessibilityMode}
              onChange={(event) => setAccessibilityMode(event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block font-medium">Keyboard-first, reduced-motion play mode</span>
              <span className="text-sm text-[var(--muted-foreground)]">
                Removes non-essential animation and shows A-D / 1-4 answer shortcuts.
              </span>
            </span>
          </label>
          <div className="flex items-center gap-4">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save preferences"}
            </Button>
            {message && (
              <span role="status" className="text-sm">
                {message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
