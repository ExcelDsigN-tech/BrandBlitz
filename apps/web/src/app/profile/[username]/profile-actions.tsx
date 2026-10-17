"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AvatarCropDialog } from "@/components/profile/avatar-crop-dialog";

export function ProfileActions({ userId, isOwner }: { userId: string; isOwner?: boolean }) {
  const { data: session } = useSession();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  if (!session?.apiToken) return null;

  const currentUserId = (session.user as any)?.id || (session.user as any)?.sub;
  const isSelf = Boolean(isOwner || (currentUserId && currentUserId === userId));

  async function blockUser() {
    await createApiClient(session!.apiToken!).post(`/users/${userId}/block`);
    setMessage("Profile blocked");
  }

  async function reportUser() {
    const details = window.prompt("What should moderators review?");
    if (details === null) return;
    await createApiClient(session!.apiToken!).post(`/users/${userId}/report`, {
      reason: "other",
      details,
    });
    setMessage("Report submitted");
  }

  return (
    <div className="flex items-center gap-2">
      {isSelf ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAvatarDialogOpen(true)}
          >
            Change Avatar
          </Button>
          <AvatarCropDialog
            open={avatarDialogOpen}
            onOpenChange={setAvatarDialogOpen}
            apiToken={session.apiToken}
            onAvatarUpdated={() => {
              router.refresh();
            }}
          />
        </>
      ) : (
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => void blockUser()}>
            Block
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void reportUser()}>
            Report
          </Button>
        </>
      )}
      {message && <span className="text-xs text-[var(--muted-foreground)]">{message}</span>}
    </div>
  );
}

