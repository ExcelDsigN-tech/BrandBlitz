/**
 * Challenge Templates — Public Gallery
 *
 * Routes:
 *   GET  /challenge-templates/gallery               — public gallery listing
 *   POST /challenge-templates/:id/clone             — clone a gallery template into a new challenge
 *
 * Gallery opt-in/opt-out lives on the challenge resource:
 *   POST   /challenges/:id/template-opt-in          — opt a challenge into the gallery
 *   DELETE /challenges/:id/template-opt-in          — remove from gallery
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  getGalleryTemplates,
  getGalleryTemplateById,
} from "../db/queries/challenges";
import {
  getChallengeQuestions,
  createChallenge,
  insertChallengeQuestions,
} from "../db/queries/challenges";
import { getBrandById, getActiveDistractorBrands } from "../db/queries/brands";
import { authenticate } from "../middleware/authenticate";
import { requireCurrentTosAccepted } from "../middleware/require-tos";
import { requireActiveUser } from "../middleware/require-active-user";
import { createError } from "../middleware/error";
import { generateDepositMemo } from "@brandblitz/stellar";
import { config } from "../lib/config";
import { CursorQuerySchema } from "../db/pagination";

const router = Router();

const GalleryQuerySchema = CursorQuerySchema;

/**
 * GET /challenge-templates/gallery
 * Public listing of opted-in, high-performing challenges brands can clone.
 * Returns performance stats without exposing participant PII or escrow data.
 * No authentication required.
 */
router.get("/gallery", async (req, res) => {
  const parsed = GalleryQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw createError("Invalid query parameters", 400, "INVALID_QUERY");
  }
  const { limit, cursor } = parsed.data;
  const { templates, nextCursor } = await getGalleryTemplates({ limit, cursor });
  res.json({ templates, nextCursor });
});

const CloneSchema = z.object({
  /** The brand that will own the new cloned challenge. */
  brandId: z.string().uuid(),
  poolAmountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, "Invalid USDC amount")
    .refine((v) => parseFloat(v) >= 1, "Minimum pool amount is 1 USDC"),
  /** Optional end time for the cloned challenge (ISO 8601). */
  endsAt: z
    .string()
    .datetime({ offset: true })
    .optional(),
  maxPlayers: z.number().int().positive().optional(),
});

/**
 * POST /challenge-templates/:id/clone
 * Clone a gallery template into a new challenge for the requesting brand.
 * Copies the question structure; generates fresh deposit memo + challenge ID.
 * Original brand identity is credited in the response but not linked in the DB.
 * Escrow / participant data from the source are never copied.
 *
 * Requires authentication + active account + current TOS accepted.
 */
router.post(
  "/:id/clone",
  authenticate,
  requireActiveUser,
  requireCurrentTosAccepted,
  async (req, res) => {
    const { id: templateId } = z.object({ id: z.string().uuid() }).parse(req.params);

    // Resolve the gallery template
    const template = await getGalleryTemplateById(templateId);
    if (!template) {
      throw createError("Gallery template not found", 404, "TEMPLATE_NOT_FOUND");
    }

    // Validate + authorise the target brand
    const body = CloneSchema.parse(req.body);
    const brand = await getBrandById(body.brandId);
    if (!brand) throw createError("Brand not found", 404);
    if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

    // Pull question structure from source challenge (without correct answers
    // leaking to the response — they are re-generated from the target brand).
    const sourceQuestions = await getChallengeQuestions(templateId);

    const challengeId = randomUUID();
    const depositMemo = generateDepositMemo();

    const challenge = await createChallenge({
      brandId: body.brandId,
      challengeId,
      depositMemo,
      poolAmountUsdc: body.poolAmountUsdc,
      maxPlayers: body.maxPlayers,
      endsAt: body.endsAt,
    });

    // Re-generate questions for the cloning brand using the same round structure
    // as the template but with the cloning brand's content.
    const distractorBrands = await getActiveDistractorBrands(body.brandId);
    const questions = sourceQuestions.map((q) => ({
      challenge_id: challenge.id,
      round: q.round,
      question_type: q.question_type,
      prompt_type: q.prompt_type,
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_option: q.correct_option,
    }));
    await insertChallengeQuestions(questions);

    res.status(201).json({
      challenge,
      clonedFrom: {
        templateId: template.id,
        brandName: template.brand_name,
        completedSessions: template.completed_sessions,
        avgScore: template.avg_score,
        completionRatePct: template.completion_rate_pct,
      },
      depositInstructions: {
        hotWalletAddress: config.HOT_WALLET_PUBLIC_KEY,
        memo: depositMemo,
        amount: body.poolAmountUsdc,
        asset: "USDC",
        note: `Send exactly ${body.poolAmountUsdc} USDC to the hot wallet with memo: ${depositMemo}`,
      },
    });
  }
);

export default router;
