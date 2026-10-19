import { Router } from "express";
import { z } from "zod";
import { generateDepositMemo, MIN_POOL_STROOPS } from "@brandblitz/stellar";
import { authenticate } from "../middleware/authenticate";
import { requireCurrentTosAccepted } from "../middleware/require-tos";
import { createError } from "../middleware/error";
import { duplicateChallenge } from "../db/queries/challenge-duplication";
import { transaction } from "../db/transaction";
import { config } from "../lib/config";
import type { Challenge } from "../db/queries/challenges";

const router = Router();

router.post("/:id/duplicate", authenticate, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  res.status(201).json({ challenge: await duplicateChallenge(id, req.user!.sub) });
});

// Drafts have no deposit memo. A schedule must be supplied before funds can
// activate them through the existing deposit webhook.
router.post("/:id/publish-draft", authenticate, requireCurrentTosAccepted, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { startsAt, endsAt } = z
    .object({
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
    })
    .strict()
    .parse(req.body);
  if (
    new Date(startsAt).getTime() < Date.now() ||
    new Date(endsAt).getTime() - new Date(startsAt).getTime() < 3600000
  ) {
    throw createError(
      "Choose a future start and an end at least one hour later",
      422,
      "INVALID_DRAFT_DATES"
    );
  }
  const challenge = await transaction(async (client) => {
    const source = await client.query<Challenge & { owner_user_id: string }>(
      `SELECT c.*, b.owner_user_id FROM challenges c JOIN brands b ON b.id = c.brand_id
       WHERE c.id = $1 AND c.deleted_at IS NULL AND b.deleted_at IS NULL FOR UPDATE OF c`,
      [id]
    );
    const draft = source.rows[0];
    if (!draft) throw createError("Challenge not found", 404);
    if (draft.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);
    if (draft.status !== "draft") throw createError("Challenge is no longer a draft", 409);
    if (BigInt(draft.pool_amount_stroops) < MIN_POOL_STROOPS)
      throw createError("Pool must be at least 100 USDC", 422);
    const updated = await client.query<Challenge>(
      `UPDATE challenges SET status = 'pending_deposit', starts_at = $2, ends_at = $3,
         deposit_memo = $4, updated_at = NOW() WHERE id = $1
       RETURNING *, (pool_amount_stroops::numeric / 10000000)::numeric(20,7)::text AS pool_amount_usdc`,
      [id, startsAt, endsAt, generateDepositMemo()]
    );
    return updated.rows[0];
  });
  res.json({
    challenge,
    depositInstructions: {
      hotWalletAddress: config.HOT_WALLET_PUBLIC_KEY,
      memo: challenge.deposit_memo,
      amount: challenge.pool_amount_usdc,
      asset: "USDC",
    },
  });
});

export default router;
