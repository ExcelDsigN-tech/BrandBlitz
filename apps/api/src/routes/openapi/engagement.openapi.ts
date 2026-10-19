import { z } from "zod";
import { registerEndpoint } from "@/lib/openapi-registry";

const params = z.object({ id: z.string().uuid() });
const cursor = z.string().nullable();
const inviteCode = z
  .object({
    id: z.string().uuid(),
    brand_id: z.string().uuid(),
    challenge_id: z.string().uuid().nullable(),
    code: z.string(),
    expires_at: z.string().datetime().nullable(),
    max_uses: z.number().int().nullable(),
    use_count: z.number().int(),
    created_at: z.string().datetime(),
  })
  .openapi("InviteCode");
const comment = z
  .object({
    id: z.string().uuid(),
    challenge_id: z.string().uuid(),
    user_id: z.string().uuid(),
    body: z.string(),
    display_name: z.string(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .openapi("ChallengeComment");

registerEndpoint({
  method: "post",
  path: "/waitlist/redeem-code",
  tags: ["waitlist"],
  authenticated: true,
  summary: "Redeem a brand invite for priority waitlist access",
  description:
    "Requires an active account enrolled with its own email. Redemption is atomic, idempotent per code/user, and audit logged. Suspension is never cleared.",
  request: {
    body: z.object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{32}$/),
    }),
  },
  responses: {
    200: {
      description: "Access granted, including retries",
      schema: z.object({
        status: z.literal("active"),
        brandId: z.string().uuid(),
        challengeId: z.string().uuid().nullable(),
      }),
    },
    400: { description: "Invalid code format" },
    401: { description: "Authentication required" },
    403: { description: "Account suspended or account email not on waitlist" },
    404: { description: "Unknown or deleted-scope code" },
    409: { description: "Code exhausted" },
    410: { description: "Code expired" },
    429: { description: "Too many attempts" },
  },
});
registerEndpoint({
  method: "get",
  path: "/waitlist/access",
  tags: ["waitlist"],
  authenticated: true,
  summary: "Check the authenticated account's waitlist access",
  responses: {
    200: {
      description: "Current access",
      schema: z.object({ status: z.enum(["not_enrolled", "waiting", "active"]) }),
    },
    401: { description: "Authentication required" },
  },
});
registerEndpoint({
  method: "post",
  path: "/brands/:id/invite-codes",
  tags: ["brands"],
  authenticated: true,
  summary: "Generate a brand or challenge invite (brand owner only)",
  request: {
    params,
    body: z.object({
      challengeId: z.string().uuid().optional(),
      expiresAt: z.string().datetime({ offset: true }).optional(),
      maxUses: z.number().int().min(1).max(100000).optional(),
    }),
  },
  responses: {
    201: { description: "Generated code", schema: z.object({ inviteCode }) },
    400: { description: "Invalid expiry or limit" },
    403: { description: "Not the brand owner" },
    404: { description: "Challenge does not belong to brand" },
  },
});
registerEndpoint({
  method: "get",
  path: "/brands/:id/invite-codes",
  tags: ["brands"],
  authenticated: true,
  summary: "View codes and usage (brand owner only)",
  request: { params, query: z.object({ cursor: z.string().optional() }) },
  responses: {
    200: {
      description: "Up to 100 codes, newest first",
      schema: z.object({ data: z.array(inviteCode), nextCursor: cursor }),
    },
    400: { description: "Invalid cursor" },
    403: { description: "Not the brand owner" },
  },
});
registerEndpoint({
  method: "get",
  path: "/brands/:id/retention",
  tags: ["brands"],
  authenticated: true,
  summary: "Weekly cross-challenge cohort retention (brand viewer or higher)",
  description:
    "Monday UTC cohorts, based on first non-practice, non-flagged live-session participation. Later weeks count distinct users returning to a different challenge. Completed zero-return weeks are included; future weeks are omitted. Week 0 and up to 12 later weeks are returned.",
  request: { params },
  responses: {
    200: {
      description: "Empty cohorts when fewer than two challenges or no eligible participants",
      schema: z.object({
        challengeCount: z.number().int(),
        cohorts: z.array(
          z.object({
            cohort_week: z.string(),
            cohort_size: z.number().int(),
            week_offset: z.number().int(),
            retained_users: z.number().int(),
            retention_pct: z.number(),
          })
        ),
      }),
    },
    403: { description: "Not a brand member" },
    404: { description: "Brand not found" },
  },
});
registerEndpoint({
  method: "get",
  path: "/challenges/:id/comments",
  tags: ["challenges"],
  summary: "Read a persistent challenge discussion",
  request: {
    params,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Comments newest first (default page size 20)",
      schema: z.object({ data: z.array(comment), nextCursor: cursor }),
    },
    400: { description: "Invalid pagination" },
    404: { description: "Challenge missing, draft or deleted" },
  },
});
registerEndpoint({
  method: "post",
  path: "/challenges/:id/comments",
  tags: ["challenges"],
  authenticated: true,
  summary: "Post a plain-text challenge comment",
  request: { params, body: z.object({ body: z.string().trim().min(1).max(2000) }) },
  responses: {
    201: { description: "Comment created", schema: z.object({ comment }) },
    400: { description: "Invalid body" },
    403: { description: "Suspended or fraud-flagged account" },
    404: { description: "Challenge missing, draft or deleted" },
    422: { description: "Profanity or spam" },
    429: { description: "Duplicate body or more than five comments/minute" },
  },
});
const draft = z
  .object({
    id: z.string().uuid(),
    brand_id: z.string().uuid(),
    status: z.enum(["draft", "pending_deposit"]),
    starts_at: z.string().datetime().nullable(),
    ends_at: z.string().datetime().nullable(),
    deposit_memo: z.string().nullable(),
    pool_amount_usdc: z.string(),
  })
  .passthrough()
  .openapi("ChallengeDraft");
registerEndpoint({
  method: "post",
  path: "/challenges/:id/duplicate",
  tags: ["challenges"],
  authenticated: true,
  summary: "Duplicate a challenge's configuration into an unfunded draft (owner only)",
  description:
    "Copies questions, limits, payout schedule, existing licensing obligations, variants, tiers and tags. Dates, escrow state, sessions, leaderboards and experiment results are reset.",
  request: { params },
  responses: {
    201: { description: "New draft", schema: z.object({ challenge: draft }) },
    403: { description: "Not the owner" },
    404: { description: "Source missing or deleted" },
  },
});
registerEndpoint({
  method: "post",
  path: "/challenges/:id/publish-draft",
  tags: ["challenges"],
  authenticated: true,
  summary: "Set new dates and receive fresh funding instructions for a draft",
  description:
    "Requires ownership, current terms acceptance, a future start, an end at least one hour later and a minimum 100 USDC pool. Changes status to pending_deposit. Funding uses the existing deposit flow.",
  request: {
    params,
    body: z.object({
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
    }),
  },
  responses: {
    200: {
      description: "Ready to fund",
      schema: z.object({
        challenge: draft,
        depositInstructions: z.object({
          hotWalletAddress: z.string(),
          memo: z.string(),
          amount: z.string(),
          asset: z.literal("USDC"),
        }),
      }),
    },
    403: { description: "Not the owner or terms not accepted" },
    404: { description: "Draft not found" },
    409: { description: "Already scheduled" },
    422: { description: "Invalid dates or pool" },
  },
});
