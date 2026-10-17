"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { createApiClient } from "@/lib/api";
import { toast } from "@/lib/toast";

export interface BrandMember {
  id: string;
  brand_id: string;
  user_id: string | null;
  email: string;
  role: "owner" | "editor" | "viewer";
  invited_by: string;
  created_at: string;
  user_display_name?: string | null;
  user_username?: string | null;
}

interface TeamPanelProps {
  brandId: string;
  apiToken?: string;
  isOwner?: boolean;
}

export function TeamPanel({ brandId, apiToken, isOwner = true }: TeamPanelProps) {
  const [members, setMembers] = useState<BrandMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("viewer");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!apiToken) return;
    const api = createApiClient(apiToken);
    try {
      const res = await api.get(`/brands/${brandId}/members`);
      setMembers(res.data.members || []);
    } catch (err: any) {
      console.error("Failed to load brand members", err);
    } finally {
      setLoading(false);
    }
  }, [brandId, apiToken]);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !apiToken) return;

    setInviting(true);
    const api = createApiClient(apiToken);
    try {
      await api.post(`/brands/${brandId}/members`, {
        email: email.trim().toLowerCase(),
        role,
      });
      toast.success(`Invitation sent to ${email}`);
      setEmail("");
      setShowInviteForm(false);
      void fetchMembers();
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Failed to invite member";
      toast.error(msg);
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(memberId: string, memberEmail: string) {
    if (!apiToken) return;
    if (!confirm(`Are you sure you want to remove ${memberEmail} from this brand team?`)) {
      return;
    }

    setRemovingId(memberId);
    const api = createApiClient(apiToken);
    try {
      await api.delete(`/brands/${brandId}/members/${memberId}`);
      toast.success("Member removed successfully");
      void fetchMembers();
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Failed to remove member";
      toast.error(msg);
    } finally {
      setRemovingId(null);
    }
  }

  const roleBadgeVariants = {
    owner: "default" as const,
    editor: "secondary" as const,
    viewer: "outline" as const,
  };

  return (
    <CardContent className="border-t border-[var(--border)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Team Management</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Manage admin users and co-managers for this brand with role-based permissions.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowInviteForm(!showInviteForm)}
          aria-label="Toggle invite teammate"
        >
          {showInviteForm ? "Cancel" : "+ Invite Teammate"}
        </Button>
      </div>

      {showInviteForm && (
        <form
          onSubmit={handleInvite}
          className="bg-[var(--muted)]/20 mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] p-3"
        >
          <input
            type="email"
            placeholder="colleague@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="min-w-[200px] flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
            className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
          >
            <option value="editor">Editor (can manage challenges)</option>
            <option value="viewer">Viewer (read-only stats)</option>
          </select>
          <Button size="sm" type="submit" disabled={inviting}>
            {inviting ? "Inviting..." : "Send Invite"}
          </Button>
        </form>
      )}

      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-xs text-[var(--muted-foreground)]">Loading team members...</p>
        ) : members.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">No team members added yet.</p>
        ) : (
          <div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between p-2.5 text-sm">
                <div className="flex items-center gap-2.5">
                  <span className="font-medium">{member.email}</span>
                  {member.user_display_name && (
                    <span className="text-xs text-[var(--muted-foreground)]">
                      ({member.user_display_name})
                    </span>
                  )}
                  <Badge variant={roleBadgeVariants[member.role]}>{member.role}</Badge>
                </div>
                {member.role !== "owner" && isOwner && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-red-500 hover:text-red-700"
                    disabled={removingId === member.id}
                    onClick={() => handleRemove(member.id, member.email)}
                  >
                    {removingId === member.id ? "Removing..." : "Remove"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </CardContent>
  );
}
