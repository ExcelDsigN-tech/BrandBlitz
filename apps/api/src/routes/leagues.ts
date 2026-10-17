import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { createError } from "../middleware/error";
import { addUtcDays, getUtcWeekStart } from "../lib/week";
import { ensureAssignmentForUserThisWeek, getCurrentLeagueGroup, recalculateWeeklyPoints } from "../db/queries/leagues";
import { getBrandById } from "../db/queries/brands";
import { query } from "../db";

const router = Router();

const ScoringWeightsSchema = z
  .object({
    speed: z.number().min(0).max(1),
    accuracy: z.number().min(0).max(1),
    streak: z.number().min(0).max(1),
  })
  .refine((weights) => Math.abs(weights.speed + weights.accuracy + weights.streak - 1) < 0.001, {
    message: "Scoring weights must sum to 1",
  });

const LeagueBodySchema = z.object({
  brandId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  scoringWeights: ScoringWeightsSchema,
});

router.post("/", authenticate, async (req, res) => {
  const body = LeagueBodySchema.parse(req.body);
  const brand = await getBrandById(body.brandId);
  if (!brand) throw createError("Brand not found", 404);
  if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const result = await query(
    `INSERT INTO leagues (brand_id, name, scoring_weights)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id, brand_id, name, scoring_weights, created_at, updated_at`,
    [body.brandId, body.name, JSON.stringify(body.scoringWeights)]
  );
  res.status(201).json({ league: result.rows[0] });
});

router.get("/brand/:brandId", authenticate, async (req, res) => {
  const result = await query(
    `SELECT id, brand_id, name, scoring_weights, created_at, updated_at
     FROM leagues WHERE brand_id = $1 ORDER BY created_at ASC`,
    [req.params.brandId]
  );
  res.json({ leagues: result.rows });
});

router.patch("/:id", authenticate, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(100).optional(), scoringWeights: ScoringWeightsSchema.optional() }).parse(req.body);
  const current = await query<{ brand_id: string }>("SELECT brand_id FROM leagues WHERE id = $1", [req.params.id]);
  if (!current.rows[0]) throw createError("League not found", 404);
  const brand = await getBrandById(current.rows[0].brand_id);
  if (!brand || brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const result = await query(
    `UPDATE leagues
     SET name = COALESCE($2, name), scoring_weights = COALESCE($3::jsonb, scoring_weights), updated_at = NOW()
     WHERE id = $1
     RETURNING id, brand_id, name, scoring_weights, created_at, updated_at`,
    [req.params.id, parsed.name ?? null, parsed.scoringWeights ? JSON.stringify(parsed.scoringWeights) : null]
  );
  if (parsed.scoringWeights) {
    await query("UPDATE league_assignments SET scoring_weights = $2::jsonb WHERE league_id = $1", [req.params.id, JSON.stringify(parsed.scoringWeights)]);
    const weeks = await query<{ week_start: string }>("SELECT DISTINCT week_start FROM league_assignments WHERE league_id = $1", [req.params.id]);
    for (const week of weeks.rows) await recalculateWeeklyPoints(week.week_start);
  }
  res.json({ league: result.rows[0], standingsRecalculated: true, warning: "Changing scoring weights recalculates current and historical standings for this league." });
});

/**
 * GET /leagues/current
 * Returns the caller's current league + their 30-player group with points.
 */
router.get("/current", authenticate, async (req, res) => {
  const weekStart = getUtcWeekStart(new Date());

  await ensureAssignmentForUserThisWeek(req.user!.sub, weekStart);
  const current = await getCurrentLeagueGroup(req.user!.sub, weekStart);
  if (!current) throw createError("League not found", 404);

  res.json({
    weekStart,
    weekEndExclusive: addUtcDays(weekStart, 7),
    league: current.league,
    groupId: current.group_id,
    group: current.group,
  });
});

export default router;

