"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { createApiClient, api } from "@/lib/api";
import { toast } from "@/lib/toast";

export interface TeamMemberInfo {
  id: string;
  user_id: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface ChallengeTeamInfo {
  id: string;
  challenge_id: string;
  name: string;
  created_by: string;
  member_count?: number;
  is_member?: boolean;
  members?: TeamMemberInfo[];
}

interface ChallengeTeamsPanelProps {
  challengeId: string;
  apiToken?: string;
  isLoggedIn?: boolean;
}

export function ChallengeTeamsPanel({
  challengeId,
  apiToken,
  isLoggedIn = false,
}: ChallengeTeamsPanelProps) {
  const [teams, setTeams] = useState<ChallengeTeamInfo[]>([]);
  const [userTeamId, setUserTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchTeams = useCallback(async () => {
    try {
      const client = apiToken ? createApiClient(apiToken) : api;
      const res = await client.get(`/challenges/${challengeId}/teams`);
      setTeams(res.data.teams ?? []);
      setUserTeamId(res.data.userTeamId ?? null);
    } catch (err) {
      console.error("Failed to load challenge teams", err);
    } finally {
      setLoading(false);
    }
  }, [challengeId, apiToken]);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim() || !apiToken) return;

    setIsCreating(true);
    try {
      const client = createApiClient(apiToken);
      const res = await client.post(`/challenges/${challengeId}/teams`, {
        action: "create",
        name: teamName.trim(),
      });
      toast.success(`Team "${res.data.team.name}" created!`);
      setTeamName("");
      await fetchTeams();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to create team");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleJoinTeam(teamId: string, name: string) {
    if (!apiToken) {
      toast.error("Please sign in to join a team");
      return;
    }

    setActionInProgress(teamId);
    try {
      const client = createApiClient(apiToken);
      await client.post(`/challenges/${challengeId}/teams`, {
        action: "join",
        teamId,
      });
      toast.success(`Joined team "${name}"!`);
      await fetchTeams();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to join team");
    } finally {
      setActionInProgress(null);
    }
  }

  async function handleLeaveTeam() {
    if (!apiToken) return;

    setActionInProgress("leave");
    try {
      const client = createApiClient(apiToken);
      await client.delete(`/challenges/${challengeId}/teams/me`);
      toast.info("Left team");
      await fetchTeams();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to leave team");
    } finally {
      setActionInProgress(null);
    }
  }

  const userTeam = teams.find((t) => t.id === userTeamId || t.is_member);

  return (
    <Card className="border-[var(--border)] bg-[var(--card)] shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg font-semibold">Team Mode</CardTitle>
            <CardDescription className="text-xs">
              Compete as a team! Scores are aggregated on the shared team leaderboard and payouts
              are split among members.
            </CardDescription>
          </div>
          {userTeam && (
            <Badge variant="default" className="text-xs">
              Your Team: {userTeam.name}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {userTeam ? (
          <div className="border-primary/20 bg-primary/5 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="font-medium text-[var(--foreground)]">
                You are playing for: <span className="text-primary font-bold">{userTeam.name}</span>
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {userTeam.member_count ?? 1} member(s) on this team
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={actionInProgress === "leave"}
              onClick={handleLeaveTeam}
            >
              {actionInProgress === "leave" ? "Leaving..." : "Leave Team"}
            </Button>
          </div>
        ) : isLoggedIn ? (
          <form onSubmit={handleCreateTeam} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Create new team name..."
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              maxLength={50}
              className="h-9 min-w-[200px] flex-1 rounded-md border border-[var(--border)] bg-transparent px-3 text-sm placeholder:text-[var(--muted-foreground)]"
            />
            <Button size="sm" type="submit" disabled={isCreating || !teamName.trim()}>
              {isCreating ? "Creating..." : "Create Team"}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">
            Sign in to create or join a team for this challenge.
          </p>
        )}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Available Teams ({teams.length})
          </p>
          {loading ? (
            <p className="text-xs text-[var(--muted-foreground)]">Loading teams...</p>
          ) : teams.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">
              No teams created yet. Be the first to start a team!
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {teams.map((t) => {
                const isCurrent = t.id === userTeamId || t.is_member;
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between rounded-lg border p-2.5 transition-colors ${
                      isCurrent
                        ? "border-primary bg-primary/5"
                        : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--muted-foreground)]"
                    }`}
                  >
                    <div>
                      <p className="font-medium text-[var(--foreground)]">{t.name}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {t.member_count ?? 1} member(s)
                      </p>
                    </div>
                    {isCurrent ? (
                      <Badge variant="outline" className="text-xs">
                        Joined
                      </Badge>
                    ) : (
                      isLoggedIn && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={actionInProgress === t.id}
                          onClick={() => handleJoinTeam(t.id, t.name)}
                        >
                          {actionInProgress === t.id ? "Joining..." : "Join"}
                        </Button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
