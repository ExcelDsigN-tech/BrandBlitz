import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { requireActiveUser } from "../middleware/require-active-user";
import { createError } from "../middleware/error";
import { query } from "../db/index";
import { decodeCursor } from "../db/pagination";
import { isUserFraudFlagged } from "../db/queries/challenge-ratings";
import { addChallengeComment, listChallengeComments } from "../db/queries/challenge-comments";
import { validateCommentBody } from "../lib/comment-moderation";

const router = Router();
const cursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

router.get("/:id/comments", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { limit, cursor } = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().max(512).optional(),
    })
    .parse(req.query);
  let decoded: z.infer<typeof cursorSchema> | undefined;
  if (cursor) {
    try {
      decoded = cursorSchema.parse(decodeCursor(cursor, ["createdAt", "id"]));
    } catch {
      throw createError("Invalid comment cursor", 400, "INVALID_CURSOR");
    }
  }
  const challenge = await query(
    "SELECT id FROM challenges WHERE id = $1 AND deleted_at IS NULL AND status <> 'draft'",
    [id]
  );
  if (!challenge.rows.length) throw createError("Challenge not found", 404);
  res.json(await listChallengeComments(id, limit, decoded));
});

router.post("/:id/comments", authenticate, requireActiveUser, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { body } = z
    .object({ body: z.string().trim().min(1).max(2000) })
    .strict()
    .parse(req.body);
  validateCommentBody(body);
  if (await isUserFraudFlagged(req.user!.sub)) {
    throw createError(
      "Comments are unavailable while your account is under fraud review",
      403,
      "FRAUD_FLAGGED"
    );
  }
  const comment = await addChallengeComment(id, req.user!.sub, body);
  res.status(201).json({ comment });
});

export default router;
