import { Router } from "express";
import { z } from "zod";
import { query } from "../db/index";
import { createError } from "../middleware/error";
import { apiLimiter, waitlistLimiter } from "../middleware/rate-limit";

import { authenticate, optionalAuth } from "../middleware/authenticate";
import { requireActiveUser } from "../middleware/require-active-user";
import { redeemInviteCode } from "../db/queries/invite-codes";
import { scheduleChallengeReminder } from "../queues/challenge-reminder.queue";

const router = Router();

router.post("/redeem-code", authenticate, requireActiveUser, waitlistLimiter, async (req, res) => {
  const { code } = z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{32}$/),
    })
    .parse(req.body);
  res.json(await redeemInviteCode(req.user!.sub, code.toUpperCase()));
});

router.get("/access", authenticate, async (req, res) => {
  const result = await query<{ status: string }>(
    `SELECT w.status FROM waitlist w JOIN users u ON lower(u.email) = w.email
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [req.user!.sub]
  );
  res.json({ status: result.rows[0]?.status ?? "not_enrolled" });
});

const WaitlistSchema = z.object({
  email: z.string().max(254).email(),
  referral_code: z.string().max(64).optional(),
  challenge_id: z.string().uuid().optional(),
  lead_time_minutes: z.coerce.number().int().min(1).max(10080).default(15).optional(),
});

router.post("/", optionalAuth, waitlistLimiter, async (req, res) => {
  const parsed = WaitlistSchema.safeParse(req.body);
  if (!parsed.success) {
    throw createError("Invalid email address", 422, "INVALID_EMAIL");
  }
  const email = parsed.data.email.toLowerCase().trim();
  const userId = req.user?.sub ?? null;

  // RETURNING yields a row only for a new signup. The id is the caller's
  // capability for GET /:id/position, so a duplicate email never gets it back.
  const inserted = await query<{ id: string }>(
    `INSERT INTO waitlist (email, referral_code)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [email, parsed.data.referral_code ?? null]
  );
  const entry = inserted.rows[0] ? { id: inserted.rows[0].id } : {};

  let reminderScheduled = false;
  let scheduledFor: Date | null = null;

  if (parsed.data.challenge_id) {
    const chRes = await query<{ id: string; status: string; starts_at: string }>(
      "SELECT id, status, starts_at FROM challenges WHERE id = $1 AND deleted_at IS NULL AND status <> 'draft'",
      [parsed.data.challenge_id]
    );
    if (chRes.rows.length === 0) {
      throw createError("Challenge not found", 404);
    }
    if (chRes.rows[0].status === "cancelled" || chRes.rows[0].status === "refunded") {
      throw createError("Cannot register reminder for cancelled challenge", 400);
    }

    const startsAt = new Date(chRes.rows[0].starts_at);
    const leadTime = parsed.data.lead_time_minutes ?? 15;
    scheduledFor = new Date(startsAt.getTime() - leadTime * 60 * 1000);

    await query(
      `INSERT INTO challenge_reminders (challenge_id, user_id, email, lead_time_minutes, scheduled_for)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (challenge_id, email) DO UPDATE
       SET lead_time_minutes = EXCLUDED.lead_time_minutes,
           scheduled_for = EXCLUDED.scheduled_for,
           sent_at = NULL`,
      [parsed.data.challenge_id, userId, email, leadTime, scheduledFor]
    ).catch(() => null);

    await scheduleChallengeReminder({
      challengeId: parsed.data.challenge_id,
      userId: userId ?? undefined,
      email,
      leadTimeMinutes: leadTime,
      startsAt,
    }).catch(() => null);

    return res.status(201).json({
      message: "You're on the list!",
      ...entry,
      reminderScheduled: true,
      scheduledFor,
    });
  }

  res.status(201).json({
    message: "You're on the list!",
    ...entry,
  });
});

/** Window used to measure how fast entries are being let in. */
export const THROUGHPUT_WINDOW_DAYS = 7;

/**
 * Live queue position for one entry (#1046). The entry id returned by
 * POST /waitlist is an unguessable UUID and acts as the access token, so
 * nobody can look up someone else's place by email.
 */
router.get("/:id/position", apiLimiter, async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    throw createError("Waitlist entry not found", 404);
  }

  const result = await query<{ activated: boolean; ahead: number; recent_activations: number }>(
    `SELECT w.status = 'active' AS activated,
            (SELECT COUNT(*) FROM waitlist p
              WHERE p.status = 'waiting'
                AND (p.created_at, p.id) < (w.created_at, w.id))::int AS ahead,
            (SELECT COUNT(*) FROM waitlist a
              WHERE a.activated_at >= NOW() - make_interval(days => $2))::int AS recent_activations
       FROM waitlist w
      WHERE w.id = $1`,
    [id.data, THROUGHPUT_WINDOW_DAYS]
  );

  const row = result.rows[0];
  if (!row) {
    throw createError("Waitlist entry not found", 404);
  }

  const throughputPerDay = row.recent_activations / THROUGHPUT_WINDOW_DAYS;

  if (row.activated) {
    return res.json({ activated: true, position: null, estimatedWaitSeconds: 0, throughputPerDay });
  }

  const position = row.ahead + 1;
  // No activations in the window means no basis for an estimate; say so
  // instead of inventing one.
  const estimatedWaitSeconds =
    throughputPerDay > 0 ? Math.ceil((position / throughputPerDay) * 86_400) : null;

  res.json({ activated: false, position, estimatedWaitSeconds, throughputPerDay });
});

export default router;
