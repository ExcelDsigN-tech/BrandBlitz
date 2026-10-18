import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  sendPushToUser: vi.fn(),
}));

vi.mock("../db", () => ({ query: mocks.query }));

vi.mock("./push", () => ({
  sendPushToUser: mocks.sendPushToUser,
  removePushSubscription: vi.fn(),
}));

import { buildPushMessage, dispatchNotification } from "./notifications";

describe("dispatchNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ id: "notification-1" }] });
    mocks.sendPushToUser.mockResolvedValue({ sent: 1, failed: 0, pruned: 0 });
  });

  it("persists the in-app notification and sends push for payout events", async () => {
    const id = await dispatchNotification({
      userId: "user-1",
      type: "payout_received",
      payload: { amount_usdc: "12.5000000", tx_hash: "abc", challenge_id: "challenge-1" },
    });

    expect(id).toBe("notification-1");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO notifications"), [
      "user-1",
      "payout_received",
      expect.stringContaining('"amount_usdc":"12.5000000"'),
    ]);
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        title: "Payout received",
        body: "You received 12.5000000 USDC",
        url: "/profile",
        notificationId: "notification-1",
      })
    );
  });

  it("sends push for challenge reminders with a deep link", async () => {
    await dispatchNotification({
      userId: "user-1",
      type: "challenge_reminder",
      payload: {
        challenge_id: "challenge-42",
        brand_name: "Acme",
        lead_time_minutes: 15,
      },
    });

    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        title: "Challenge starting soon",
        body: "Acme starts in 15 minutes — jump in now.",
        url: "/challenge/challenge-42",
        tag: "challenge_reminder:challenge-42",
      })
    );
  });

  it("keeps non-key events in-app only", async () => {
    await dispatchNotification({
      userId: "user-1",
      type: "streak_milestone",
      payload: { milestone: 30 },
    });

    expect(mocks.query).toHaveBeenCalled();
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("does not send push when the in-app insert fails", async () => {
    mocks.query.mockRejectedValue(new Error("db down"));

    await expect(
      dispatchNotification({
        userId: "user-1",
        type: "payout_received",
        payload: { amount_usdc: "1.0000000" },
      })
    ).resolves.toBeNull();

    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });
});

describe("buildPushMessage", () => {
  it("returns null for event types that should not push", () => {
    expect(buildPushMessage("badge_earned", { badge_name: "First win" })).toBeNull();
    expect(buildPushMessage("rank_overtaken", { new_rank: 3 })).toBeNull();
  });

  it("falls back gracefully when payload fields are missing", () => {
    expect(buildPushMessage("payout_received", {})).toMatchObject({
      title: "Payout received",
      body: "You received a USDC payout",
    });
    expect(
      buildPushMessage("challenge_reminder", { challenge_id: "challenge-9", brand_name: "Acme" })
    ).toMatchObject({
      body: "Acme starts soon — jump in now.",
    });
  });
});
