import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const {
  mockCreateChallengeTeam,
  mockJoinChallengeTeam,
  mockLeaveChallengeTeam,
  mockGetChallengeTeams,
  mockGetUserChallengeTeam,
  mockGetChallengeTeamLeaderboard,
  mockGetChallengeByIdAny,
} = vi.hoisted(() => ({
  mockCreateChallengeTeam: vi.fn(),
  mockJoinChallengeTeam: vi.fn(),
  mockLeaveChallengeTeam: vi.fn(),
  mockGetChallengeTeams: vi.fn(),
  mockGetUserChallengeTeam: vi.fn(),
  mockGetChallengeTeamLeaderboard: vi.fn(),
  mockGetChallengeByIdAny: vi.fn(),
}));

vi.mock("../db/queries/challenge-teams", async () => {
  const actual = await vi.importActual<any>("../db/queries/challenge-teams");
  return {
    ...actual,
    createChallengeTeam: mockCreateChallengeTeam,
    joinChallengeTeam: mockJoinChallengeTeam,
    leaveChallengeTeam: mockLeaveChallengeTeam,
    getChallengeTeams: mockGetChallengeTeams,
    getUserChallengeTeam: mockGetUserChallengeTeam,
    getChallengeTeamLeaderboard: mockGetChallengeTeamLeaderboard,
  };
});

vi.mock("../db/queries/challenges", () => ({
  getChallengeByIdAny: mockGetChallengeByIdAny,
  getActiveChallenges: vi.fn(),
  getActiveChallengesCursor: vi.fn(),
  getActiveChallengesSorted: vi.fn(),
  getFilteredChallenges: vi.fn(),
  getChallengesByBrandId: vi.fn(),
  getChallengeQuestions: vi.fn(),
  optChallengeIntoGallery: vi.fn(),
  optChallengeOutOfGallery: vi.fn(),
}));

vi.mock("../db/queries/brands", () => ({
  getBrandById: vi.fn(),
}));

vi.mock("../db/queries/sessions", () => ({
  getLeaderboard: vi.fn(),
  getArchivedLeaderboard: vi.fn(),
  getSession: vi.fn(),
  getTopSessionsPerChallenge: vi.fn(),
  getGlobalLeaderboardFromView: vi.fn(),
  LEADERBOARD_SORTS: ["score", "fastest"],
  LEADERBOARD_WINDOWS: ["daily", "weekly", "all-time"],
}));

vi.mock("../db/queries/referrals", () => ({
  getReferralNetworkUserIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    req.user = { sub: "user-123", email: "user@brandblitz.com" };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    const auth = req.headers.authorization;
    if (auth) req.user = { sub: "user-123", email: "user@brandblitz.com" };
    next();
  },
}));

import challengesRouter from "./challenges";
import leaderboardRouter from "./leaderboard";
import { errorHandler } from "../middleware/error";
import { splitTeamPayout } from "../db/queries/challenge-teams";

const app = express();
app.use(express.json());
app.use("/challenges", challengesRouter);
app.use("/leaderboard", leaderboardRouter);
app.use(errorHandler);

describe("Team-Based Challenge Mode (#1002)", () => {
  const challengeId = "11111111-1111-4111-8111-111111111111";
  const teamId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChallengeByIdAny.mockResolvedValue({
      id: challengeId,
      status: "active",
      brand_id: "brand-1",
    });
  });

  it("POST /challenges/:id/teams creates a new team with creator as member", async () => {
    mockCreateChallengeTeam.mockResolvedValueOnce({
      id: teamId,
      challenge_id: challengeId,
      name: "Blitz Strikers",
      created_by: "user-123",
      member_count: 1,
      is_member: true,
    });

    const res = await request(app)
      .post(`/challenges/${challengeId}/teams`)
      .set("Authorization", "Bearer valid")
      .send({ name: "Blitz Strikers" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.team.name).toBe("Blitz Strikers");
    expect(mockCreateChallengeTeam).toHaveBeenCalledWith(challengeId, "Blitz Strikers", "user-123");
  });

  it("POST /challenges/:id/teams joins an existing team via teamId", async () => {
    mockJoinChallengeTeam.mockResolvedValueOnce({
      team: { id: teamId, name: "Blitz Strikers" },
      membership: { id: "mem-1", team_id: teamId, user_id: "user-123" },
    });

    const res = await request(app)
      .post(`/challenges/${challengeId}/teams`)
      .set("Authorization", "Bearer valid")
      .send({ action: "join", teamId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.team.id).toBe(teamId);
    expect(mockJoinChallengeTeam).toHaveBeenCalledWith(challengeId, teamId, "user-123");
  });

  it("GET /challenges/:id/teams lists challenge teams and user membership", async () => {
    mockGetChallengeTeams.mockResolvedValueOnce([
      { id: teamId, name: "Blitz Strikers", member_count: 3, is_member: true, members: [] },
    ]);
    mockGetUserChallengeTeam.mockResolvedValueOnce({ id: teamId, name: "Blitz Strikers" });

    const res = await request(app)
      .get(`/challenges/${challengeId}/teams`)
      .set("Authorization", "Bearer valid");

    expect(res.status).toBe(200);
    expect(res.body.teams).toHaveLength(1);
    expect(res.body.userTeamId).toBe(teamId);
  });

  it("GET /leaderboard/:challengeId?scope=teams returns team-aggregated standings", async () => {
    mockGetChallengeTeamLeaderboard.mockResolvedValueOnce([
      {
        rank: 1,
        teamId,
        teamName: "Blitz Strikers",
        challengeId,
        memberCount: 3,
        totalScore: 1250,
        avgScore: 416.67,
        totalEarnedUsdc: 0,
        members: [
          { userId: "u1", username: "alice", score: 450 },
          { userId: "u2", username: "bob", score: 400 },
          { userId: "u3", username: "charlie", score: 400 },
        ],
      },
    ]);

    const res = await request(app).get(`/leaderboard/${challengeId}?scope=teams`);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("teams");
    expect(res.body.teams).toHaveLength(1);
    expect(res.body.teams[0].totalScore).toBe(1250);
  });

  describe("splitTeamPayout", () => {
    it("splits team payout proportionally when members have positive scores", () => {
      const teamPool = 10000000n; // 1 USDC in stroops (10^7)
      const members = [
        { userId: "u1", address: "G_ALICE", score: 300 },
        { userId: "u2", address: "G_BOB", score: 100 },
      ];

      const splits = splitTeamPayout(teamPool, members);
      expect(splits).toHaveLength(2);
      expect(splits[0].userId).toBe("u1");
      expect(splits[1].userId).toBe("u2");

      const totalSplit = splits.reduce((acc, s) => acc + s.amountStroops, 0n);
      expect(totalSplit).toBe(teamPool);
      expect(splits[0].amountStroops).toBe(7500000n);
      expect(splits[1].amountStroops).toBe(2500000n);
    });

    it("splits equally when scores are 0", () => {
      const teamPool = 10000000n;
      const members = [
        { userId: "u1", address: "G_ALICE", score: 0 },
        { userId: "u2", address: "G_BOB", score: 0 },
      ];

      const splits = splitTeamPayout(teamPool, members);
      expect(splits).toHaveLength(2);
      expect(splits[0].amountStroops).toBe(5000000n);
      expect(splits[1].amountStroops).toBe(5000000n);
    });
  });
});
