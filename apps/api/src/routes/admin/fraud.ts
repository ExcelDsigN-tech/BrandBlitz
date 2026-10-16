import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireAdmin } from "../../middleware/require-admin";
import { createError } from "../../middleware/error";
import {
  getFraudFlags,
  getFraudFlagById,
  updateFraudFlagStatus,
  setFraudScoreOverride,
  getUserReports,
} from "../../db/queries/fraud-flags";
import { CursorQuerySchema } from "../../db/pagination";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

const ListQuerySchema = CursorQuerySchema.extend({
  status: z.enum(["open", "resolved", "escalated"]).optional(),
}).refine((data) => !("page" in data), {
  message: "Use ?cursor for pagination. Legacy ?page parameter is no longer supported.",
});

const PatchBodySchema = z.object({
  status: z.enum(["resolved", "escalated"]),
  reason: z.string().min(1, "Resolution reason is required"),
}).strict();

const FraudScoreOverrideBodySchema = z.object({
  // null clears a previously set override, reverting to the computed score.
  score: z.number().int().min(0).nullable(),
  reason: z.string().min(1, "Override reason is required"),
}).strict();

/**
 * GET /admin/fraud-flags
 * Paginated list of fraud flags. Supports keyset cursor pagination via ?cursor.
 * Optional ?status= filter.
 */
router.get("/", async (req, res) => {
  const { status, cursor, limit: pageSize } = ListQuerySchema.parse(req.query);
  const { flags, nextCursor } = await getFraudFlags({ status, cursor, pageSize });
  const reports = await getUserReports({ status, limit: pageSize });

  res.json({
    flags: flags.map((f) => ({
      id: f.id,
      sessionId: f.session_id,
      userId: f.user_id,
      userDisplayName: f.user_display_name,
      userEmail: f.user_email,
      challengeId: f.challenge_id,
      flagType: f.flag_type,
      details: f.details,
      status: f.status,
      resolutionReason: f.resolution_reason,
      resolvedBy: f.resolved_by,
      resolvedAt: f.resolved_at,
      createdAt: f.created_at,
      reactionTimes: {
        round1Ms: f.round_1_reaction_ms,
        round2Ms: f.round_2_reaction_ms,
        round3Ms: f.round_3_reaction_ms,
      },
      sessionFlagReasons: f.session_flag_reasons,
      deviceId: f.device_id,
    })),
    reports: reports.map((report) => ({
      id: report.id,
      type: "user_report",
      reporterId: report.reporter_id,
      reportedId: report.reported_id,
      reason: report.reason,
      details: report.details,
      status: report.status,
      createdAt: report.created_at,
    })),
    pagination: {
      pageSize,
      nextCursor,
    },
  });
});

/**
 * PATCH /admin/fraud-flags/:id
 * Transition flag state: open → resolved | escalated.
 * Resolution reason is required and logged to audit_log.
 */
router.patch("/:id", async (req, res) => {
  const { status, reason } = PatchBodySchema.parse(req.body);

  const existing = await getFraudFlagById(req.params.id);
  if (!existing) throw createError("Fraud flag not found", 404, "NOT_FOUND");

  const updated = await updateFraudFlagStatus(
    req.params.id,
    status,
    reason,
    req.user!.sub
  );

  res.json({
    id: updated!.id,
    status: updated!.status,
    resolutionReason: updated!.resolution_reason,
    resolvedBy: updated!.resolved_by,
    resolvedAt: updated!.resolved_at,
  });
});

/**
 * POST /admin/fraud-flags/users/:userId/score-override
 * Manually overrides a user's fraud score (null clears the override),
 * with a required reason logged to audit_log (#1010).
 */
router.post("/users/:userId/score-override", async (req, res) => {
  const { score, reason } = FraudScoreOverrideBodySchema.parse(req.body);

  const updated = await setFraudScoreOverride(
    req.params.userId,
    score,
    reason,
    req.user!.sub
  );
  if (!updated) throw createError("User not found", 404, "NOT_FOUND");

  res.json({
    userId: updated.user_id,
    fraudScoreOverride: updated.fraud_score_override,
    fraudScoreOverrideReason: updated.fraud_score_override_reason,
    fraudScoreOverrideBy: updated.fraud_score_override_by,
    fraudScoreOverrideAt: updated.fraud_score_override_at,
  });
});

export default router;
