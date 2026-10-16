import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { apiLimiter } from "../../middleware/rate-limit";
import { findUserById } from "../../db/queries/users";
import { collectUserData } from "../../db/queries/data-export";
import { createError } from "../../middleware/error";

const router = Router();

/**
 * GET /me/export
 * Self-serve GDPR right-to-data-portability (Article 20). Streams a JSON file
 * containing every record BrandBlitz holds about the authenticated user.
 * Rate-limited to prevent abuse; the download is safe to repeat.
 */
router.get("/", authenticate, apiLimiter, async (req, res) => {
  const userId = req.user!.sub;

  const user = await findUserById(userId);
  if (!user) throw createError("User not found", 404);

  const data = await collectUserData(userId);

  const filename = `brandblitz-data-export-${userId}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");

  res.json({
    userId,
    email: user.email,
    exportedAt: data.exportedAt,
    formatVersion: 1,
    data: {
      profile: data.profile,
      sessions: data.sessions,
      payouts: data.payouts,
      badges: data.badges,
      ratings: data.ratings,
      referrals: data.referrals,
      referralPayouts: data.referralPayouts,
      fraudFlags: data.fraudFlags,
      erasureRequests: data.erasureRequests,
    },
  });
});

export default router;
