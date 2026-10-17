-- Migration: Create recalculate_league(p_week DATE) stored procedure (#492)
-- Wraps the entire weekly league recalculation in a single atomic transaction.
-- Called by the simplified BullMQ league worker instead of multiple sequential queries.

CREATE OR REPLACE PROCEDURE recalculate_league(p_week DATE)
LANGUAGE plpgsql
AS $$
DECLARE
  v_week_end DATE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  v_week_end := p_week + INTERVAL '7 days';

  -- Step 1: Recalculate weekly points from completed game sessions
  WITH sums AS (
    SELECT
      gs.user_id,
      COALESCE(SUM(ROUND(1000 * (
        ((CASE WHEN gs.round_1_score > 0 THEN 1 ELSE 0 END + CASE WHEN gs.round_2_score > 0 THEN 1 ELSE 0 END + CASE WHEN gs.round_3_score > 0 THEN 1 ELSE 0 END)::numeric / 3) * COALESCE((la.scoring_weights->>'accuracy')::numeric, (l.scoring_weights->>'accuracy')::numeric, 0.4)
        + COALESCE(1 - ((gs.round_1_reaction_ms + gs.round_2_reaction_ms + gs.round_3_reaction_ms)::numeric / NULLIF(90000, 0)), 0) * COALESCE((la.scoring_weights->>'speed')::numeric, (l.scoring_weights->>'speed')::numeric, 0.4)
        + LEAST(u.streak::numeric / 10, 1) * COALESCE((la.scoring_weights->>'streak')::numeric, (l.scoring_weights->>'streak')::numeric, 0.2)
      ))), 0)::bigint AS points
    FROM game_sessions gs
    JOIN users u ON u.id = gs.user_id
    JOIN league_assignments la ON la.user_id = gs.user_id AND la.week_start = p_week
    LEFT JOIN leagues l ON l.id = la.league_id OR (la.league_id IS NULL AND l.brand_id IS NULL AND l.name = la.league)
    WHERE gs.status = 'completed'
      AND gs.completed_at >= p_week
      AND gs.completed_at < v_week_end
    GROUP BY gs.user_id
  )
  UPDATE league_assignments la
  SET weekly_points = COALESCE(s.points, 0),
      updated_at = v_now
  FROM sums s
  WHERE la.user_id = s.user_id
    AND la.week_start = p_week;

  -- Step 2: Rank within groups and set promoted / demoted flags
  WITH ranked AS (
    SELECT
      la.id,
      la.league,
      la.group_id,
      la.weekly_points,
      ROW_NUMBER() OVER (
        PARTITION BY la.league, la.group_id
        ORDER BY la.weekly_points DESC, la.user_id ASC
      ) AS rnk,
      COUNT(*) OVER (PARTITION BY la.league, la.group_id) AS grp_count
    FROM league_assignments la
    WHERE la.week_start = p_week
  )
  UPDATE league_assignments la
  SET
    rank_in_group = r.rnk,
    promoted = (r.league IN ('bronze', 'silver') AND r.rnk <= 3),
    demoted  = (r.league IN ('silver', 'gold') AND r.rnk > GREATEST(r.grp_count - 3, 0)),
    updated_at = v_now
  FROM ranked r
  WHERE la.id = r.id;

  -- Step 3: Insert audit_log entry for the recalculation
  INSERT INTO audit_log (actor_id, action, entity, entity_key, after, created_at)
  VALUES (
    NULL,
    'league.recalculated',
    'league',
    p_week::text,
    jsonb_build_object('week', p_week::text, 'recalculated_at', v_now),
    v_now
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- Down migration:
-- DROP PROCEDURE IF EXISTS recalculate_league(DATE);
