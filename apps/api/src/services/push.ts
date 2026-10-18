/**
 * Web Push delivery service (issue #1009).
 *
 * Loads every device subscription for a user and delivers a push message,
 * pruning endpoints the push service reports as gone and dropping devices
 * that fail repeatedly.
 */

import { query } from "../db";
import { logger } from "../lib/logger";
import { isWebPushConfigured, sendWebPush, type WebPushMessage } from "../lib/web-push";

/** Consecutive failures after which a subscription is considered dead. */
export const MAX_PUSH_FAILURES = 5;

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

export interface PushDispatchSummary {
  sent: number;
  failed: number;
  pruned: number;
}

async function deleteSubscription(id: string): Promise<void> {
  try {
    await query(`DELETE FROM push_subscriptions WHERE id = $1`, [id]);
  } catch (err) {
    logger.warn("Failed to prune push subscription", { id, err });
  }
}

async function markDelivered(id: string): Promise<void> {
  try {
    await query(
      `UPDATE push_subscriptions
       SET last_used_at = NOW(), failure_count = 0, updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  } catch (err) {
    logger.warn("Failed to record push delivery", { id, err });
  }
}

async function recordFailure(id: string, failureCount: number): Promise<void> {
  try {
    await query(
      `UPDATE push_subscriptions
       SET failure_count = $2, updated_at = NOW()
       WHERE id = $1`,
      [id, failureCount]
    );
  } catch (err) {
    logger.warn("Failed to record push failure", { id, err });
  }
}

/**
 * Send a push message to every subscribed device for a user.
 *
 * Respects the per-user push preference (`users.push_notifications_enabled`),
 * which is independent of in-app notifications. Never throws.
 */
export async function sendPushToUser(
  userId: string,
  message: WebPushMessage
): Promise<PushDispatchSummary> {
  const summary: PushDispatchSummary = { sent: 0, failed: 0, pruned: 0 };

  if (!isWebPushConfigured()) return summary;

  let subscriptions: PushSubscriptionRow[];
  try {
    const result = await query<PushSubscriptionRow>(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps.failure_count
       FROM push_subscriptions ps
       JOIN users u ON u.id = ps.user_id
       WHERE ps.user_id = $1
         AND u.push_notifications_enabled = TRUE
         AND u.deleted_at IS NULL`,
      [userId]
    );
    subscriptions = result.rows;
  } catch (err) {
    logger.warn("Failed to load push subscriptions", { userId, err });
    return summary;
  }

  if (subscriptions.length === 0) return summary;

  const outcomes = await Promise.all(
    subscriptions.map(async (subscription): Promise<keyof PushDispatchSummary | null> => {
      const result = await sendWebPush(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        message
      );

      if (result.ok) {
        await markDelivered(subscription.id);
        return "sent";
      }

      // 404/410 means the browser or push service dropped the subscription.
      // A malformed p256dh/auth key is equally unrecoverable.
      if (result.expired || result.error === "invalid_subscription") {
        await deleteSubscription(subscription.id);
        return "pruned";
      }

      const failures = subscription.failure_count + 1;
      if (failures >= MAX_PUSH_FAILURES) {
        await deleteSubscription(subscription.id);
        return "pruned";
      }

      await recordFailure(subscription.id, failures);
      return "failed";
    })
  );

  for (const outcome of outcomes) {
    if (outcome) summary[outcome] += 1;
  }

  return summary;
}

/** Remove a single device subscription (used when the user disables push). */
export async function removePushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `DELETE FROM push_subscriptions
     WHERE user_id = $1 AND endpoint = $2
     RETURNING id`,
    [userId, endpoint]
  );
  return result.rows.length > 0;
}
