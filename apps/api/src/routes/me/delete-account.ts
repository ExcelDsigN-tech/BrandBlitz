import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { createError } from "../../middleware/error";
import { findUserById } from "../../db/queries/users";
import {
  createErasureRequest,
  findPendingErasureRequest,
  findPendingSelfErasureRequest,
  cancelErasureRequest,
} from "../../db/queries/gdpr";
import { enqueueGdprErasure, cancelGdprErasure } from "../../queues/gdpr-erasure.queue";

const router = Router();

/**
 * POST /me/delete-account
 * Self-serve GDPR right-to-erasure request.
 * Requires the user to confirm their email address in the request body.
 * Starts a 30-day grace period; the account is anonymised after the window elapses.
 */
router.post("/", authenticate, async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);

  const user = await findUserById(req.user!.sub);
  if (!user) throw createError("User not found", 404);

  if (user.email.toLowerCase() !== email.toLowerCase()) {
    throw createError("Email confirmation does not match your account email", 403);
  }

  const existing = await findPendingErasureRequest(user.id);
  if (existing) throw createError("A deletion request is already pending for this account", 409);

  const erasureRequest = await createErasureRequest(user.id);
  await enqueueGdprErasure({ userId: user.id, requestId: erasureRequest.id });

  res.status(202).json({
    message:
      "Your account deletion request has been received. Your data will be anonymised after a 30-day grace period.",
    executeAt: erasureRequest.execute_at,
  });
});

/**
 * DELETE /me/delete-account
 * Cancel a self-initiated account deletion within the 30-day grace period.
 * Admin-initiated legal erasures are not visible here and must be cancelled
 * through the admin endpoint.
 */
router.delete("/", authenticate, async (req, res) => {
  const pending = await findPendingSelfErasureRequest(req.user!.sub);
  if (!pending) throw createError("No pending deletion request found", 404);

  await cancelErasureRequest(req.user!.sub);
  await cancelGdprErasure(req.user!.sub);

  res.json({ message: "Your account deletion request has been cancelled." });
});

export default router;
