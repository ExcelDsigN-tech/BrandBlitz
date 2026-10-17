import { randomUUID } from "node:crypto";
import { transaction } from "../transaction";
import { createChallenge, type Challenge } from "./challenges";
import { createError } from "../../middleware/error";

export async function duplicateChallenge(challengeId: string, actorId: string) {
  return transaction(async (client) => {
    const source = await client.query<Challenge & { owner_user_id: string }>(
      `SELECT c.*, b.owner_user_id,
         (c.pool_amount_stroops::numeric / 10000000)::numeric(20,7)::text AS pool_amount_usdc
       FROM challenges c JOIN brands b ON b.id = c.brand_id
       WHERE c.id = $1 AND c.deleted_at IS NULL AND b.deleted_at IS NULL FOR SHARE OF c, b`,
      [challengeId]
    );
    const original = source.rows[0];
    if (!original) throw createError("Challenge not found", 404);
    if (original.owner_user_id !== actorId)
      throw createError("Only the owning brand can duplicate this challenge", 403);
    const duplicate = await createChallenge(
      {
        brandId: original.brand_id,
        challengeId: randomUUID(),
        poolAmountUsdc: original.pool_amount_usdc,
        maxPlayers: original.max_players ?? undefined,
        payoutSchedule: original.payout_schedule,
        licenseId: original.challenge_license_id ?? undefined,
        draft: true,
      },
      client
    );
    await client.query(
      `INSERT INTO challenge_questions (challenge_id, round, question_type, prompt_type,
         question_text, option_a, option_b, option_c, option_d, correct_option)
       SELECT $2, round, question_type, prompt_type, question_text,
         option_a, option_b, option_c, option_d, correct_option
       FROM challenge_questions WHERE challenge_id = $1`,
      [original.id, duplicate.id]
    );
    // These optional features live in legacy migrations on older deployments.
    // Copy configuration when installed, without copying experiment results.
    const optional = await client.query<{
      variants: string | null;
      tiers: string | null;
      tags: string | null;
    }>(
      "SELECT to_regclass('challenge_variants')::text AS variants, to_regclass('challenge_tiers')::text AS tiers, to_regclass('challenge_tag_map')::text AS tags"
    );
    if (optional.rows[0].variants)
      await client.query(
        `INSERT INTO challenge_variants (challenge_id, name, question_config)
       SELECT $2, name, question_config FROM challenge_variants WHERE challenge_id = $1`,
        [original.id, duplicate.id]
      );
    if (optional.rows[0].tiers)
      await client.query(
        `INSERT INTO challenge_tiers (challenge_id, name, entry_fee_stroops, prize_pool_stroops)
       SELECT $2, name, entry_fee_stroops, prize_pool_stroops FROM challenge_tiers WHERE challenge_id = $1`,
        [original.id, duplicate.id]
      );
    if (optional.rows[0].tags)
      await client.query(
        "INSERT INTO challenge_tag_map (challenge_id, tag_id) SELECT $2, tag_id FROM challenge_tag_map WHERE challenge_id = $1",
        [original.id, duplicate.id]
      );
    await client.query(
      `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
       VALUES ($1, 'challenge.duplicated', 'challenge', $2, $3::jsonb)`,
      [actorId, duplicate.id, JSON.stringify({ sourceChallengeId: original.id })]
    );
    return duplicate;
  });
}
