import { query } from "../index";
import { calculatePayoutShareStroops } from "../../lib/usdc";

export interface ChallengeTeam {
  id: string;
  challenge_id: string;
  name: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  member_count?: number;
  is_member?: boolean;
}

export interface TeamMember {
  id: string;
  team_id: string;
  challenge_id: string;
  user_id: string;
  joined_at: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  stellar_address?: string | null;
}

export interface TeamLeaderboardEntry {
  rank: number;
  teamId: string;
  teamName: string;
  challengeId: string;
  memberCount: number;
  totalScore: number;
  avgScore: number;
  totalEarnedUsdc: number;
  members: {
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    score: number;
  }[];
}

/**
 * Create a new team for a challenge and automatically add the creator as member.
 */
export async function createChallengeTeam(
  challengeId: string,
  name: string,
  userId: string
): Promise<ChallengeTeam> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Team name cannot be empty");
  }

  // Insert team
  const teamRes = await query<ChallengeTeam>(
    `INSERT INTO challenge_teams (challenge_id, name, created_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [challengeId, trimmed, userId]
  );
  const team = teamRes.rows[0];

  // Add creator as member (upsert if previously in another team)
  await query(
    `INSERT INTO team_members (team_id, challenge_id, user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (challenge_id, user_id)
     DO UPDATE SET team_id = EXCLUDED.team_id, joined_at = NOW()`,
    [team.id, challengeId, userId]
  );

  return {
    ...team,
    member_count: 1,
    is_member: true,
  };
}

/**
 * Join an existing challenge team. Switches team if user was in a different team for this challenge.
 */
export async function joinChallengeTeam(
  challengeId: string,
  teamId: string,
  userId: string
): Promise<{ team: ChallengeTeam; membership: TeamMember }> {
  // Verify team exists in this challenge
  const teamRes = await query<ChallengeTeam>(
    `SELECT * FROM challenge_teams WHERE id = $1 AND challenge_id = $2`,
    [teamId, challengeId]
  );
  const team = teamRes.rows[0];
  if (!team) {
    throw new Error("Team not found for this challenge");
  }

  const memRes = await query<TeamMember>(
    `INSERT INTO team_members (team_id, challenge_id, user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (challenge_id, user_id)
     DO UPDATE SET team_id = EXCLUDED.team_id, joined_at = NOW()
     RETURNING *`,
    [teamId, challengeId, userId]
  );

  return {
    team,
    membership: memRes.rows[0],
  };
}

/**
 * Leave current team for a challenge.
 */
export async function leaveChallengeTeam(challengeId: string, userId: string): Promise<boolean> {
  const res = await query(`DELETE FROM team_members WHERE challenge_id = $1 AND user_id = $2`, [
    challengeId,
    userId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Get user's current team for a challenge, if any.
 */
export async function getUserChallengeTeam(
  challengeId: string,
  userId: string
): Promise<ChallengeTeam | null> {
  const res = await query<ChallengeTeam>(
    `SELECT ct.*
     FROM challenge_teams ct
     JOIN team_members tm ON tm.team_id = ct.id
     WHERE ct.challenge_id = $1 AND tm.user_id = $2`,
    [challengeId, userId]
  );
  return res.rows[0] ?? null;
}

/**
 * List all teams for a challenge with member counts and current user's membership.
 */
export async function getChallengeTeams(
  challengeId: string,
  currentUserId?: string
): Promise<(ChallengeTeam & { members: TeamMember[] })[]> {
  const teamsRes = await query<ChallengeTeam>(
    `SELECT ct.*,
            COUNT(tm.id)::int AS member_count,
            BOOL_OR(tm.user_id = $2) AS is_member
     FROM challenge_teams ct
     LEFT JOIN team_members tm ON tm.team_id = ct.id
     WHERE ct.challenge_id = $1
     GROUP BY ct.id
     ORDER BY ct.created_at ASC`,
    [challengeId, currentUserId ?? null]
  );

  const membersRes = await query<TeamMember>(
    `SELECT tm.*, u.username, u.display_name, u.avatar_url
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.challenge_id = $1
     ORDER BY tm.joined_at ASC`,
    [challengeId]
  );

  const membersByTeam = new Map<string, TeamMember[]>();
  for (const m of membersRes.rows) {
    const list = membersByTeam.get(m.team_id) ?? [];
    list.push(m);
    membersByTeam.set(m.team_id, list);
  }

  return teamsRes.rows.map((t) => ({
    ...t,
    is_member: Boolean(t.is_member),
    members: membersByTeam.get(t.id) ?? [],
  }));
}

/**
 * Aggregate team-based leaderboard for a challenge (#1002).
 */
export async function getChallengeTeamLeaderboard(
  challengeId: string,
  limit = 50
): Promise<TeamLeaderboardEntry[]> {
  const result = await query<{
    team_id: string;
    team_name: string;
    challenge_id: string;
    member_count: number;
    total_score: string;
    avg_score: string;
    members_json: string;
  }>(
    `WITH user_challenge_scores AS (
       SELECT
         s.user_id,
         COALESCE(MAX(s.total_score), 0)::int AS user_score
       FROM game_sessions s
       WHERE s.challenge_id = $1
         AND s.flagged = FALSE
         AND s.completed_at IS NOT NULL
       GROUP BY s.user_id
     ),
     team_user_scores AS (
       SELECT
         ct.id AS team_id,
         ct.name AS team_name,
         ct.challenge_id,
         tm.user_id,
         u.username,
         u.display_name,
         u.avatar_url,
         COALESCE(ucs.user_score, 0) AS score
       FROM challenge_teams ct
       JOIN team_members tm ON tm.team_id = ct.id
       JOIN users u ON u.id = tm.user_id
       LEFT JOIN user_challenge_scores ucs ON ucs.user_id = tm.user_id
       WHERE ct.challenge_id = $1
     )
     SELECT
       team_id,
       team_name,
       challenge_id,
       COUNT(user_id)::int AS member_count,
       COALESCE(SUM(score), 0)::int AS total_score,
       ROUND(COALESCE(AVG(score), 0), 2)::numeric AS avg_score,
       JSON_AGG(
         JSON_BUILD_OBJECT(
           'userId', user_id,
           'username', username,
           'displayName', display_name,
           'avatarUrl', avatar_url,
           'score', score
         ) ORDER BY score DESC
       )::text AS members_json
     FROM team_user_scores
     GROUP BY team_id, team_name, challenge_id
     ORDER BY total_score DESC, member_count DESC
     LIMIT $2`,
    [challengeId, limit]
  );

  return result.rows.map((row, idx) => {
    let parsedMembers: any[] = [];
    try {
      parsedMembers = JSON.parse(row.members_json);
    } catch {
      parsedMembers = [];
    }

    return {
      rank: idx + 1,
      teamId: row.team_id,
      teamName: row.team_name,
      challengeId: row.challenge_id,
      memberCount: Number(row.member_count),
      totalScore: Number(row.total_score),
      avgScore: Number(row.avg_score),
      totalEarnedUsdc: 0,
      members: parsedMembers,
    };
  });
}

/**
 * Split a team's total payout among its members (#1002).
 * Reuses calculatePayoutShareStroops or equal division.
 */
export function splitTeamPayout(
  teamTotalStroops: bigint,
  members: { userId: string; address: string; score?: number }[]
): { userId: string; address: string; amountStroops: bigint }[] {
  const eligible = members.filter((m) => Boolean(m.address && m.address.trim()));
  if (eligible.length === 0 || teamTotalStroops <= 0n) {
    return [];
  }

  const totalPoints = eligible.reduce((sum, m) => sum + (m.score ?? 0), 0);

  // If members have differing positive scores, split proportionally; otherwise split equally
  if (totalPoints > 0) {
    let allocated = 0n;
    const allocations: { userId: string; address: string; amountStroops: bigint }[] = [];

    for (let i = 0; i < eligible.length; i++) {
      const m = eligible[i];
      if (i === eligible.length - 1) {
        // Last member gets any remainder so nothing is lost to rounding
        const remaining = teamTotalStroops - allocated;
        if (remaining > 0n) {
          allocations.push({ userId: m.userId, address: m.address, amountStroops: remaining });
        }
      } else {
        const share = calculatePayoutShareStroops(m.score ?? 0, totalPoints, teamTotalStroops);
        allocations.push({ userId: m.userId, address: m.address, amountStroops: share });
        allocated += share;
      }
    }
    return allocations.filter((a) => a.amountStroops > 0n);
  }

  // Equal split
  const perMember = teamTotalStroops / BigInt(eligible.length);
  if (perMember <= 0n) return [];

  let allocated = 0n;
  const allocations: { userId: string; address: string; amountStroops: bigint }[] = [];
  for (let i = 0; i < eligible.length; i++) {
    const m = eligible[i];
    const amount = i === eligible.length - 1 ? teamTotalStroops - allocated : perMember;
    allocations.push({ userId: m.userId, address: m.address, amountStroops: amount });
    allocated += amount;
  }
  return allocations.filter((a) => a.amountStroops > 0n);
}
