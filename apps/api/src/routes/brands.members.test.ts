import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const {
  mockGetBrandById,
  mockGetBrandMemberRole,
  mockGetBrandMembers,
  mockAddBrandMember,
  mockRemoveBrandMember,
  mockFindUserByEmail,
} = vi.hoisted(() => ({
  mockGetBrandById: vi.fn(),
  mockGetBrandMemberRole: vi.fn(),
  mockGetBrandMembers: vi.fn(),
  mockAddBrandMember: vi.fn(),
  mockRemoveBrandMember: vi.fn(),
  mockFindUserByEmail: vi.fn(),
}));

vi.mock("../db/queries/brands", () => ({
  getBrandById: mockGetBrandById,
  toBrandApi: (b: any) => b,
}));

vi.mock("../db/queries/brand-members", () => ({
  getBrandMemberRole: mockGetBrandMemberRole,
  hasRequiredBrandRole: (role: any, required: any) => {
    const H: Record<string, number> = { owner: 3, editor: 2, viewer: 1 };
    return (H[role] ?? 0) >= (H[required] ?? 0);
  },
  getBrandMembers: mockGetBrandMembers,
  addBrandMember: mockAddBrandMember,
  removeBrandMember: mockRemoveBrandMember,
}));

vi.mock("../db/queries/users", () => ({
  findUserByEmail: mockFindUserByEmail,
}));

vi.mock("../services/budget-alerts", () => ({
  checkBrandBudgetThreshold: vi.fn(),
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    if (auth.includes("owner")) req.user = { sub: "user-owner", email: "owner@brand.com" };
    else if (auth.includes("editor")) req.user = { sub: "user-editor", email: "editor@brand.com" };
    else if (auth.includes("viewer")) req.user = { sub: "user-viewer", email: "viewer@brand.com" };
    else if (auth.includes("stranger"))
      req.user = { sub: "user-stranger", email: "stranger@other.com" };
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => next(),
}));

import brandsRouter from "./brands";
import { errorHandler } from "../middleware/error";

const app = express();
app.use(express.json());
app.use("/brands", brandsRouter);
app.use(errorHandler);

describe("Brand Members & RBAC (#1007)", () => {
  const brandId = "b1111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBrandById.mockResolvedValue({
      id: brandId,
      owner_user_id: "user-owner",
      name: "Acme Corp",
      deleted_at: null,
    });
  });

  it("allows owner, editor, and viewer to list members, but forbids outsider", async () => {
    mockGetBrandMemberRole.mockImplementation(async (bId, uId) => {
      if (uId === "user-owner") return "owner";
      if (uId === "user-editor") return "editor";
      if (uId === "user-viewer") return "viewer";
      return null;
    });

    mockGetBrandMembers.mockResolvedValue([
      { id: "m1", brand_id: brandId, email: "owner@brand.com", role: "owner" },
      { id: "m2", brand_id: brandId, email: "editor@brand.com", role: "editor" },
    ]);

    // Viewer can view
    const resViewer = await request(app)
      .get(`/brands/${brandId}/members`)
      .set("Authorization", "Bearer viewer");
    expect(resViewer.status).toBe(200);
    expect(resViewer.body.members).toHaveLength(2);

    // Stranger forbidden
    const resStranger = await request(app)
      .get(`/brands/${brandId}/members`)
      .set("Authorization", "Bearer stranger");
    expect(resStranger.status).toBe(403);
  });

  it("only owner can invite a teammate (POST /brands/:id/members)", async () => {
    mockGetBrandMemberRole.mockImplementation(async (bId, uId) => {
      if (uId === "user-owner") return "owner";
      if (uId === "user-editor") return "editor";
      return null;
    });

    mockFindUserByEmail.mockResolvedValue({ id: "user-new", email: "new@brand.com" });
    mockAddBrandMember.mockResolvedValue({
      id: "m-new",
      brand_id: brandId,
      user_id: "user-new",
      email: "new@brand.com",
      role: "editor",
    });

    // Editor trying to invite fails with 403
    const resEditor = await request(app)
      .post(`/brands/${brandId}/members`)
      .set("Authorization", "Bearer editor")
      .send({ email: "new@brand.com", role: "editor" });
    expect(resEditor.status).toBe(403);

    // Owner can invite
    const resOwner = await request(app)
      .post(`/brands/${brandId}/members`)
      .set("Authorization", "Bearer owner")
      .send({ email: "new@brand.com", role: "editor" });
    expect(resOwner.status).toBe(201);
    expect(resOwner.body.member.email).toBe("new@brand.com");
  });

  it("rejects invalid role invite", async () => {
    mockGetBrandMemberRole.mockResolvedValue("owner");

    const res = await request(app)
      .post(`/brands/${brandId}/members`)
      .set("Authorization", "Bearer owner")
      .send({ email: "invalid@brand.com", role: "superadmin" });
    expect(res.status).toBe(400);
  });

  it("only owner can remove a member, and cannot remove the last owner", async () => {
    mockGetBrandMemberRole.mockImplementation(async (bId, uId) => {
      if (uId === "user-owner") return "owner";
      if (uId === "user-editor") return "editor";
      return null;
    });

    mockGetBrandMembers.mockResolvedValue([
      { id: "m-owner", brand_id: brandId, user_id: "user-owner", role: "owner" },
      { id: "m-editor", brand_id: brandId, user_id: "user-editor", role: "editor" },
    ]);
    mockRemoveBrandMember.mockResolvedValue(true);

    // Editor cannot remove
    const resEditor = await request(app)
      .delete(`/brands/${brandId}/members/m-editor`)
      .set("Authorization", "Bearer editor");
    expect(resEditor.status).toBe(403);

    // Owner cannot remove the last owner
    const resRemoveOwner = await request(app)
      .delete(`/brands/${brandId}/members/m-owner`)
      .set("Authorization", "Bearer owner");
    expect(resRemoveOwner.status).toBe(400);
    const errText = resRemoveOwner.body.error?.message || resRemoveOwner.body.error;
    expect(errText).toMatch(/cannot remove the last owner/i);

    // Owner can remove editor
    const resRemoveEditor = await request(app)
      .delete(`/brands/${brandId}/members/m-editor`)
      .set("Authorization", "Bearer owner");
    expect(resRemoveEditor.status).toBe(200);
    expect(resRemoveEditor.body.removed).toBe(true);
  });
});
