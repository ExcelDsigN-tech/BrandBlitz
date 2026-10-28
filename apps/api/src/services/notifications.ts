/**
 * Notification dispatch (issue #1009).
 *
 * Every notification is persisted to the `notifications` table (the in-app
 * inbox polled by NotificationBell). Key event types are additionally
 * delivered over Web Push so users see them with the app closed.
 */

import { query } from "../db";
import { logger } from "../lib/logger";
import type { WebPushMessage } from "../lib/web-push";
import { sendPushToUser } from "./push";

export type NotificationType =
  | "payout_received"
  | "badge_earned"
  | "streak_milestone"
  | "rank_overtaken"
  | "challenge_reminder";

/**
 * Event types that are worth interrupting the user for outside the browser.
 * Everything else stays in-app only.
 */
export const PUSH_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  "payout_received",
  "challenge_reminder",
]);

export interface DispatchNotificationInput {
  userId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Build the visible push message for a notification, or null to stay in-app only. */
export function buildPushMessage(
  type: NotificationType,
  payload: Record<string, unknown>,
  notificationId?: string
): WebPushMessage | null {
  switch (type) {
    case "payout_received": {
      const amount = asString(payload.amount_usdc);
      return {
        title: "Payout received",
        body: amount ? `You received ${amount} USDC` : "You received a USDC payout",
        url: "/profile",
        tag: "payout_received",
        notificationId,
      };
    }
    case "challenge_reminder": {
      const brand = asString(payload.brand_name);
      const challengeId = asString(payload.challenge_id);
      const leadTime = asNumber(payload.lead_time_minutes);
      const startsIn = leadTime ? ` starts in ${leadTime} minutes` : " starts soon";
      return {
        title: "Challenge starting soon",
        body: `${brand ?? "A challenge"}${startsIn} — jump in now.`,
        url: challengeId ? `/challenge/${challengeId}` : "/challenges",
        tag: challengeId ? `challenge_reminder:${challengeId}` : "challenge_reminder",
        notificationId,
      };
    }
    default:
      return null;
  }
}

/**
 * Persist a notification and, for key event types, fan it out over Web Push.
 *
 * Returns the notification id (or null when persistence failed). Push failures
 * are logged and never bubble up to the caller's business logic.
 */
export async function dispatchNotification(
  input: DispatchNotificationInput
): Promise<string | null> {
  let notificationId: string | null = null;

  try {
    const result = await query<{ id: string }>(
      `INSERT INTO notifications (user_id, type, payload)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id`,
      [input.userId, input.type, JSON.stringify(input.payload)]
    );
    notificationId = result.rows[0]?.id ?? null;
  } catch (err) {
    logger.warn("Failed to insert notification", {
      userId: input.userId,
      type: input.type,
      err,
    });
    return null;
  }

  if (PUSH_NOTIFICATION_TYPES.has(input.type)) {
    const message = buildPushMessage(input.type, input.payload, notificationId ?? undefined);
    if (message) {
      void sendPushToUser(input.userId, message).catch((err) => {
        logger.warn("Failed to dispatch web push notification", {
          userId: input.userId,
          type: input.type,
          err,
        });
      });
    }
  }

  return notificationId;
}
