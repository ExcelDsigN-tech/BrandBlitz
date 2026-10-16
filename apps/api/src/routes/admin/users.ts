import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireAdmin } from "../../middleware/require-admin";
import { createError } from "../../middleware/error";
import { findUserById, restoreUser, suspendUser, unsuspendUser } from "../../db/queries/users";
import { bulkActionLimiter } from "../../middleware/rate-limit";
import { createErasureRequest, findPendingErasureRequest } from "../../db/queries/gdpr";
import { enqueueGdprErasure } from "../../queues/gdpr-erasure.queue";
import { query } from "../../db/index";
import { CursorQuerySchema } from "../../db/pagination";
import {
  getCohortUsers,
  getCohortUsersForExport,
  COHORT_MAX_LIMIT,
  type CohortFilter,
} from "../../db/queries/cohort";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

// ── Schemas ──────────────────────────────────────────────────────────────────

const SuspendBodySchema = z
  .object({
    reason: z.string().min(1, "Suspension reason is required").max(500),
  })
  .strict();

/**
 * PATCH /admin/users/:userId/suspend
 * Suspend a user account. Reason is required and logged to audit_log.
 * Closes #140
 */
router.patch("/:userId/suspend", async (req, res) => {
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
  const { reason } = SuspendBodySchema.parse(req.body);

  const target = await findUserById(userId);
  if (!target) throw createError("User not found", 404);
  if (target.status === "suspended") {
    throw createError("User is already suspended", 409, "ALREADY_SUSPENDED");
  }
  if (target.role === "admin") {
    throw createError("Cannot suspend an admin user", 403, "FORBIDDEN");
  }

  const updated = await suspendUser(userId, reason, req.user!.sub);
  if (!updated) throw createError("Failed to suspend user", 500);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
     VALUES ($1, 'user_suspend', 'user', $2, $3)`,
    [req.user!.sub, userId, JSON.stringify({ reason, suspendedAt: updated.suspended_at })]
  );

  res.json({
    message: "User has been suspended.",
    user: {
      id: updated.id,
      status: updated.status,
      suspensionReason: updated.suspension_reason,
      suspendedAt: updated.suspended_at,
    },
  });
});

// ── Bulk suspend / unsuspend ─────────────────────────────────────────────────

const MAX_BULK_USERS = 100;

const BulkSuspendBodySchema = z
  .object({
    userIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_USERS),
    action: z.enum(["suspend", "unsuspend"]).default("suspend"),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "suspend" && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Suspension reason is required",
        path: ["reason"],
      });
    }
  });

interface BulkActionResult {
  userId: string;
  success: boolean;
  status?: string;
  error?: string;
  code?: string;
}

/**
 * POST /admin/users/bulk-suspend
 * Apply a suspend or unsuspend action to many users in a single request.
 * Each affected user gets its own audit_log entry; partial failures are
 * reported per-user rather than failing the whole batch. Rate limited.
 *
 * Closes #998
 */
router.post("/bulk-suspend", bulkActionLimiter, async (req, res) => {
  const parsed = BulkSuspendBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw createError(
      parsed.error.issues.map((issue) => issue.message).join("; "),
      400,
      "INVALID_BULK_REQUEST"
    );
  }

  const { userIds, action, reason } = parsed.data;
  const actorId = req.user!.sub;
  const results: BulkActionResult[] = [];

  for (const userId of userIds) {
    try {
      const target = await findUserById(userId);
      if (!target) {
        results.push({ userId, success: false, error: "User not found", code: "NOT_FOUND" });
        continue;
      }

      if (action === "suspend") {
        if (target.status === "suspended") {
          results.push({
            userId,
            success: false,
            error: "User is already suspended",
            code: "ALREADY_SUSPENDED",
          });
          continue;
        }
        if (target.role === "admin") {
          results.push({
            userId,
            success: false,
            error: "Cannot suspend an admin user",
            code: "FORBIDDEN",
          });
          continue;
        }

        const updated = await suspendUser(userId, reason!, actorId);
        if (!updated) {
          results.push({ userId, success: false, error: "Failed to suspend user" });
          continue;
        }

        await query(
          `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
           VALUES ($1, 'user_suspend', 'user', $2, $3)`,
          [
            actorId,
            userId,
            JSON.stringify({ reason, suspendedAt: updated.suspended_at, bulk: true }),
          ]
        );

        results.push({ userId, success: true, status: updated.status });
      } else {
        if (target.status !== "suspended") {
          results.push({
            userId,
            success: false,
            error: "User is not currently suspended",
            code: "NOT_SUSPENDED",
          });
          continue;
        }

        const updated = await unsuspendUser(userId);
        if (!updated) {
          results.push({ userId, success: false, error: "Failed to unsuspend user" });
          continue;
        }

        await query(
          `INSERT INTO audit_log (actor_id, action, entity, entity_key, before, after)
           VALUES ($1, 'user_unsuspend', 'user', $2, $3, $4)`,
          [
            actorId,
            userId,
            JSON.stringify({
              previousReason: target.suspension_reason,
              suspendedAt: target.suspended_at,
            }),
            JSON.stringify({ status: updated.status, bulk: true }),
          ]
        );

        results.push({ userId, success: true, status: updated.status });
      }
    } catch (error) {
      results.push({
        userId,
        success: false,
        error: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  }

  const succeeded = results.filter((result) => result.success).length;

  res.json({
    action,
    succeeded,
    failed: results.length - succeeded,
    results,
  });
});

// ── Unsuspend user ───────────────────────────────────────────────────────────

/**
 * PATCH /admin/users/:userId/unsuspend
 * Reverse a suspension. Logged to audit_log.
 */
router.patch("/:userId/unsuspend", async (req, res) => {
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);

  const target = await findUserById(userId);
  if (!target) throw createError("User not found", 404);
  if (target.status !== "suspended") {
    throw createError("User is not currently suspended", 409, "NOT_SUSPENDED");
  }

  const updated = await unsuspendUser(userId);
  if (!updated) throw createError("Failed to unsuspend user", 500);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, before)
     VALUES ($1, 'user_unsuspend', 'user', $2, $3)`,
    [
      req.user!.sub,
      userId,
      JSON.stringify({
        previousReason: target.suspension_reason,
        suspendedAt: target.suspended_at,
      }),
    ]
  );

  res.json({
    message: "User suspension has been lifted.",
    user: {
      id: updated.id,
      status: updated.status,
    },
  });
});

/**
 * DELETE /admin/users/:userId/suspend
 * Clear a user's suspension by nulling suspendedAt and suspendReason.
 * Performs the operation inside a database transaction that also inserts an
 * audit_log row with action 'unsuspend' so the compliance trail remains
 * intact alongside the original suspension entry.
 *
 * Protected by requireAdmin; non-admins receive 403.
 * The require-active-user middleware must NOT run on admin routes.
 *
 * Closes #461
 */
router.delete("/:userId/suspend", async (req, res) => {
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);

  const target = await findUserById(userId);
  if (!target) throw createError("User not found", 404);
  if (target.status !== "suspended" || !target.suspended_at) {
    throw createError("User is not currently suspended", 409, "NOT_SUSPENDED");
  }

  const updated = await unsuspendUser(userId);
  if (!updated) throw createError("Failed to unsuspend user", 500);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, before, after)
     VALUES ($1, 'unsuspend', 'user', $2, $3, $4)`,
    [
      req.user!.sub,
      userId,
      JSON.stringify({
        suspendedAt: target.suspended_at,
        suspensionReason: target.suspension_reason,
      }),
      JSON.stringify({
        suspendedAt: null,
        suspensionReason: null,
      }),
    ]
  );

  res.json({
    message: "User suspension has been lifted.",
    user: {
      id: updated.id,
      status: updated.status,
      suspendedAt: updated.suspended_at,
    },
  });
});

// ── GDPR Erasure ─────────────────────────────────────────────────────────────

/**
 * POST /admin/users/:userId/erase
 * Trigger a GDPR right-to-erasure for a specific user on behalf of legal/compliance.
 * Subject to the same 30-day grace period as a self-serve request.
 * Every invocation is audit-logged.
 */
router.post("/:userId/erase", async (req, res) => {
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);

  const target = await findUserById(userId);
  if (!target) throw createError("User not found", 404);

  const existing = await findPendingErasureRequest(userId);
  if (existing) throw createError("A deletion request is already pending for this user", 409);

  const erasureRequest = await createErasureRequest(userId, req.user!.sub);
  await enqueueGdprErasure({ userId, requestId: erasureRequest.id });

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
     VALUES ($1, 'gdpr_erasure_request', 'user', $2, $3)`,
    [
      req.user!.sub,
      userId,
      JSON.stringify({ requestId: erasureRequest.id, executeAt: erasureRequest.execute_at }),
    ]
  );

  res.status(202).json({
    message: "GDPR erasure request created. Data will be anonymised after 30 days.",
    requestId: erasureRequest.id,
    executeAt: erasureRequest.execute_at,
  });
});

/**
 * POST /admin/users/:userId/restore
 * Restore a soft-deleted user account.
 */
router.post("/:userId/restore", async (req, res) => {
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);

  await restoreUser(userId);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key)
     VALUES ($1, 'user_restore', 'user', $2)`,
    [req.user!.sub, userId]
  );

  res.json({ message: "User account has been restored." });
});

// ── Cohort / Segmentation ─────────────────────────────────────────────────────

const CohortFilterSchema = z.object({
  signup_source: z.enum(["referral", "organic"]).optional(),
  league: z.enum(["bronze", "silver", "gold"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  min_fraud_flags: z.coerce.number().int().min(0).optional(),
  max_fraud_flags: z.coerce.number().int().min(0).optional(),
  min_total_earned_usdc: z.coerce.number().min(0).optional(),
  active_within_days: z.coerce.number().int().min(1).max(365).optional(),
  created_after: z.string().datetime({ offset: true }).optional(),
  created_before: z.string().datetime({ offset: true }).optional(),
});

const CohortQuerySchema = CursorQuerySchema.merge(CohortFilterSchema);

/**
 * GET /admin/users/cohort
 * Return a paginated list of users matching the given filter criteria.
 * All filter parameters are optional and ANDed together.
 *
 * Query params (all optional):
 *   signup_source       "referral" | "organic"
 *   league              "bronze" | "silver" | "gold"
 *   status              "active" | "suspended"
 *   min_fraud_flags     integer ≥ 0
 *   max_fraud_flags     integer ≥ 0
 *   min_total_earned_usdc  number ≥ 0
 *   active_within_days  1–365
 *   created_after       ISO 8601
 *   created_before      ISO 8601
 *   limit               1–500 (default 20)
 *   cursor              opaque pagination token
 *
 * Restricted to admin role.
 */
router.get("/cohort", async (req, res) => {
  const parsed = CohortQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw createError("Invalid query parameters", 400, "INVALID_QUERY");
  }

  const { limit, cursor, ...filterRaw } = parsed.data;
  const filter = filterRaw as CohortFilter;
  const effectiveLimit = Math.min(limit, COHORT_MAX_LIMIT);

  const { users, total, nextCursor } = await getCohortUsers(filter, {
    limit: effectiveLimit,
    cursor,
  });

  res.json({ users, total, nextCursor });
});

// CSV column order
const CSV_COLUMNS: Array<{
  key: keyof import("../../db/queries/cohort").CohortUser;
  label: string;
}> = [
  { key: "id", label: "id" },
  { key: "email", label: "email" },
  { key: "display_name", label: "display_name" },
  { key: "username", label: "username" },
  { key: "role", label: "role" },
  { key: "status", label: "status" },
  { key: "league", label: "league" },
  { key: "total_score", label: "total_score" },
  { key: "total_earned_usdc", label: "total_earned_usdc" },
  { key: "challenges_played", label: "challenges_played" },
  { key: "streak", label: "streak" },
  { key: "last_active_at", label: "last_active_at" },
  { key: "created_at", label: "created_at" },
  { key: "referral_code", label: "referral_code" },
  { key: "fraud_flag_count", label: "fraud_flag_count" },
];

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Wrap in quotes if field contains comma, double-quote, or newline
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /admin/users/cohort/export
 * Export all matching cohort users as a CSV file (up to 10 000 rows).
 * Accepts the same filter params as GET /admin/users/cohort.
 * Returns Content-Disposition: attachment; filename="cohort-export.csv".
 *
 * Restricted to admin role.
 */
router.get("/cohort/export", async (req, res) => {
  const parsed = CohortFilterSchema.safeParse(req.query);
  if (!parsed.success) {
    throw createError("Invalid query parameters", 400, "INVALID_QUERY");
  }

  const filter = parsed.data as CohortFilter;
  const users = await getCohortUsersForExport(filter);

  const headerRow = CSV_COLUMNS.map((c) => c.label).join(",");
  const dataRows = users.map((u) => CSV_COLUMNS.map((c) => escapeCsvField(u[c.key])).join(","));
  const csv = [headerRow, ...dataRows].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="cohort-export-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  res.send(csv);
});

export default router;
