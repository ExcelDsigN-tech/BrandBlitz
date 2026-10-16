// Issue #1017: Scheduled email digest of challenge performance for brands
import { query } from "../db/index";

interface BrandDigestData {
  brandId: string;
  brandName: string;
  email: string;
  activeChallenges: number;
  totalPlays: number;
  completionRate: number;
  totalSpendUsdc: string;
  topPerformingChallenge?: {
    name: string;
    plays: number;
  };
}

/**
 * Compile digest data for a specific brand using stats aggregation logic.
 * Reuses patterns from apps/api/src/routes/admin/stats.ts but scoped per brand.
 */
async function getBrandDigestData(brandId: string, days: number): Promise<BrandDigestData | null> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const result = await query<{
    brand_id: string;
    brand_name: string;
    email: string;
    active_challenges: number;
    total_plays: number;
    completed_plays: number;
    total_spend_usdc: string;
    top_challenge_name: string | null;
    top_challenge_plays: number | null;
  }>(
    `SELECT 
       b.id AS brand_id,
       b.name AS brand_name,
       b.contact_email AS email,
       COUNT(DISTINCT c.id) AS active_challenges,
       COUNT(gs.id) AS total_plays,
       COUNT(gs.id) FILTER (WHERE gs.completed_at IS NOT NULL) AS completed_plays,
       COALESCE(SUM(p.amount_usdc), 0) AS total_spend_usdc,
       (
         SELECT ch.title 
         FROM challenges ch
         JOIN game_sessions gss ON gss.challenge_id = ch.id
         WHERE ch.brand_id = b.id AND gss.created_at >= $2
         GROUP BY ch.id, ch.title
         ORDER BY COUNT(gss.id) DESC
         LIMIT 1
       ) AS top_challenge_name,
       (
         SELECT COUNT(gss.id)::int
         FROM challenges ch
         JOIN game_sessions gss ON gss.challenge_id = ch.id
         WHERE ch.brand_id = b.id AND gss.created_at >= $2
         GROUP BY ch.id
         ORDER BY COUNT(gss.id) DESC
         LIMIT 1
       ) AS top_challenge_plays
     FROM brands b
     LEFT JOIN challenges c ON c.brand_id = b.id AND c.status = 'active'
     LEFT JOIN game_sessions gs ON gs.challenge_id = c.id AND gs.created_at >= $2
     LEFT JOIN payouts p ON p.game_session_id = gs.id AND p.status = 'completed'
     WHERE b.id = $1
     GROUP BY b.id, b.name, b.contact_email`,
    [brandId, since]
  );

  if (result.length === 0 || !result[0].email) {
    return null;
  }

  const row = result[0];
  const completionRate =
    row.total_plays > 0 ? (row.completed_plays / row.total_plays) * 100 : 0;

  return {
    brandId: row.brand_id,
    brandName: row.brand_name,
    email: row.email,
    activeChallenges: row.active_challenges,
    totalPlays: row.total_plays,
    completionRate: Math.round(completionRate * 100) / 100,
    totalSpendUsdc: row.total_spend_usdc,
    topPerformingChallenge:
      row.top_challenge_name && row.top_challenge_plays
        ? { name: row.top_challenge_name, plays: row.top_challenge_plays }
        : undefined,
  };
}

/**
 * Send email digest to a brand. Placeholder for actual email integration.
 * TODO: Integrate with transactional email service (SendGrid, Postmark, etc.)
 */
async function sendDigestEmail(data: BrandDigestData, frequency: string): Promise<void> {
  console.log(`[brand-digest] Sending ${frequency} digest to ${data.email}:`, {
    brandId: data.brandId,
    activeChallenges: data.activeChallenges,
    totalPlays: data.totalPlays,
    completionRate: data.completionRate,
    totalSpendUsdc: data.totalSpendUsdc,
  });

  // TODO: Replace with actual email service integration
  // Example:
  // await emailService.send({
  //   to: data.email,
  //   subject: `Your ${frequency} BrandBlitz Performance Digest`,
  //   template: 'brand-digest',
  //   data: {
  //     brandName: data.brandName,
  //     activeChallenges: data.activeChallenges,
  //     totalPlays: data.totalPlays,
  //     completionRate: data.completionRate,
  //     totalSpendUsdc: data.totalSpendUsdc,
  //     topPerformingChallenge: data.topPerformingChallenge,
  //   }
  // });
}

/**
 * Process all brands that are due for a digest at the given frequency.
 * Idempotent: uses last_sent_at to prevent double-sending on retry.
 */
export async function processBrandDigests(frequency: "daily" | "weekly" | "monthly"): Promise<{
  processed: number;
  sent: number;
  errors: number;
}> {
  const days = frequency === "daily" ? 1 : frequency === "weekly" ? 7 : 30;
  const cooldownHours = frequency === "daily" ? 23 : frequency === "weekly" ? 167 : 719; // prevent re-send within period

  // Find brands that are enabled, match frequency, and haven't been sent within cooldown
  const brands = await query<{ brand_id: string; frequency: string }>(
    `SELECT brand_id, frequency
     FROM brand_digest_preferences
     WHERE enabled = TRUE
       AND frequency = $1
       AND (last_sent_at IS NULL OR last_sent_at < NOW() - INTERVAL '1 hour' * $2)
     ORDER BY COALESCE(last_sent_at, '1970-01-01'::timestamptz) ASC
     LIMIT 100`,
    [frequency, cooldownHours]
  );

  let sent = 0;
  let errors = 0;

  for (const { brand_id, frequency: freq } of brands) {
    try {
      const digestData = await getBrandDigestData(brand_id, days);
      if (!digestData) {
        console.warn(`[brand-digest] No data or email for brand ${brand_id}, skipping`);
        continue;
      }

      await sendDigestEmail(digestData, freq);

      // Mark as sent to prevent double-send on retry (idempotent)
      await query(
        `UPDATE brand_digest_preferences 
         SET last_sent_at = NOW(), updated_at = NOW()
         WHERE brand_id = $1`,
        [brand_id]
      );

      sent++;
    } catch (error) {
      console.error(`[brand-digest] Failed to send digest for brand ${brand_id}:`, error);
      errors++;
    }
  }

  return { processed: brands.length, sent, errors };
}
