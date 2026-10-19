import { query } from "../db";
import { logger } from "../lib/logger";

export interface BrandBudgetCheckResult {
  brandId: string;
  brandName: string;
  budgetThreshold: number;
  currentEscrowBalanceUsdc: number;
  alertTriggered: boolean;
  alreadySent: boolean;
  notificationId?: string;
}

/**
 * Calculates current active escrow balance across all active challenges for a brand.
 * 1 USDC = 10^7 stroops
 */
export async function getBrandActiveEscrowBalanceUsdc(brandId: string): Promise<number> {
  const result = await query<{ total_stroops: string }>(
    `SELECT COALESCE(SUM(pool_amount_stroops), 0)::text AS total_stroops
     FROM challenges
     WHERE brand_id = $1
       AND status = 'active'
       AND deleted_at IS NULL`,
    [brandId]
  );

  const stroops = BigInt(result.rows[0]?.total_stroops || "0");
  return Number(stroops) / 10_000_000;
}

/**
 * Checks a brand's remaining active escrow balance against its configured budget threshold.
 * If below threshold and no alert has been sent for this event, creates an in-app notification,
 * logs/dispatches alert, and records `budget_alert_sent = TRUE`.
 * If balance is topped up above threshold, resets `budget_alert_sent = FALSE`.
 */
export async function checkBrandBudgetThreshold(
  brandId: string
): Promise<BrandBudgetCheckResult | null> {
  const brandRes = await query<{
    id: string;
    name: string;
    owner_user_id: string;
    budget_threshold: string | null;
    budget_alert_sent: boolean;
    budget_alert_sent_at: string | null;
  }>(
    `SELECT id, name, owner_user_id, budget_threshold, budget_alert_sent, budget_alert_sent_at
     FROM brands
     WHERE id = $1 AND deleted_at IS NULL`,
    [brandId]
  );

  const brand = brandRes.rows[0];
  if (!brand || brand.budget_threshold === null || brand.budget_threshold === undefined) {
    return null;
  }

  const threshold = parseFloat(brand.budget_threshold);
  if (isNaN(threshold) || threshold < 0) {
    return null;
  }

  const balanceUsdc = await getBrandActiveEscrowBalanceUsdc(brand.id);

  if (balanceUsdc < threshold) {
    if (brand.budget_alert_sent) {
      // Alert already fired for this crossing event
      return {
        brandId: brand.id,
        brandName: brand.name,
        budgetThreshold: threshold,
        currentEscrowBalanceUsdc: balanceUsdc,
        alertTriggered: false,
        alreadySent: true,
      };
    }

    // Fire alert and record
    const title = `Budget Alert: Low Escrow Balance for ${brand.name}`;
    const message = `The remaining active escrow pool balance for "${brand.name}" is $${balanceUsdc.toFixed(
      2
    )} USDC, which has fallen below your configured alert threshold of $${threshold.toFixed(2)} USDC.`;

    const notifRes = await query<{ id: string }>(
      `INSERT INTO brand_notifications (brand_id, user_id, type, title, message, metadata)
       VALUES ($1, $2, 'budget_alert', $3, $4, $5)
       RETURNING id`,
      [
        brand.id,
        brand.owner_user_id,
        title,
        message,
        JSON.stringify({
          brandId: brand.id,
          balanceUsdc,
          threshold,
          timestamp: new Date().toISOString(),
        }),
      ]
    );

    await query(
      `UPDATE brands
       SET budget_alert_sent = TRUE, budget_alert_sent_at = NOW()
       WHERE id = $1`,
      [brand.id]
    );

    logger.warn(
      `[budget-alerts] Low escrow balance alert fired for brand ${brand.name} (${brand.id})`,
      {
        balanceUsdc,
        threshold,
        notificationId: notifRes.rows[0]?.id,
      }
    );

    return {
      brandId: brand.id,
      brandName: brand.name,
      budgetThreshold: threshold,
      currentEscrowBalanceUsdc: balanceUsdc,
      alertTriggered: true,
      alreadySent: false,
      notificationId: notifRes.rows[0]?.id,
    };
  } else {
    // Balance is at or above threshold. If alert was previously sent, reset it so next dip alerts.
    if (brand.budget_alert_sent) {
      await query(`UPDATE brands SET budget_alert_sent = FALSE WHERE id = $1`, [brand.id]);
    }

    return {
      brandId: brand.id,
      brandName: brand.name,
      budgetThreshold: threshold,
      currentEscrowBalanceUsdc: balanceUsdc,
      alertTriggered: false,
      alreadySent: false,
    };
  }
}

/**
 * Periodically checks all brands that have a budget threshold configured.
 */
export async function checkAllBrandsBudgetThresholds(): Promise<BrandBudgetCheckResult[]> {
  const brands = await query<{ id: string }>(
    `SELECT id FROM brands WHERE budget_threshold IS NOT NULL AND deleted_at IS NULL`
  );

  const results: BrandBudgetCheckResult[] = [];
  for (const b of brands.rows) {
    try {
      const result = await checkBrandBudgetThreshold(b.id);
      if (result) results.push(result);
    } catch (err) {
      logger.error(`[budget-alerts] Error checking budget threshold for brand ${b.id}`, {
        error: err,
      });
    }
  }

  return results;
}
