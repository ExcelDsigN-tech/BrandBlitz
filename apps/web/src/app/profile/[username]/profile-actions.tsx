"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function ProfileActions({ userId }: { userId: string }) {
  const { data: session } = useSession();
  const [message, setMessage] = useState<string | null>(null);
  if (!session?.apiToken) return null;

  async function blockUser() {
    await createApiClient(session.apiToken).post(`/users/${userId}/block`);
    setMessage("Profile blocked");
  }

  async function reportUser() {
    const details = window.prompt("What should moderators review?");
    if (details === null) return;
    await createApiClient(session.apiToken).post(`/users/${userId}/report`, {
      reason: "other",
      details,
    });
    setMessage("Report submitted");
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => void blockUser()}>
        Block
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => void reportUser()}>
        Report
      </Button>
      {message && <span className="text-xs text-[var(--muted-foreground)]">{message}</span>}
    </div>
  );
}
