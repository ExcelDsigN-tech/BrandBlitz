import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  sendWebPush: vi.fn(),
  isWebPushConfigured: vi.fn(),
}));

vi.mock("../db", () => ({ query: mocks.query }));

vi.mock("../lib/web-push", () => ({
  isWebPushConfigured: mocks.isWebPushConfigured,
  sendWebPush: mocks.sendWebPush,
}));

import { MAX_PUSH_FAILURES, sendPushToUser } from "./push";

const message = { title: "Payout received", body: "You received 5 USDC", url: "/profile" };

function subscription(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sub-1",
    endpoint: "https://push.example.com/sub-1",
    p256dh: "p256dh-key",
    auth: "auth-key",
    failure_count: 0,
    ...overrides,
  };
}

function mockSubscriptions(rows: ReturnType<typeof subscription>[]) {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM push_subscriptions ps")) return { rows };
    return { rows: [] };
  });
}

function executedSql(): string[] {
  return mocks.query.mock.calls.map(([sql]) => String(sql));
}

describe("sendPushToUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isWebPushConfigured.mockReturnValue(true);
    mocks.sendWebPush.mockResolvedValue({ ok: true, expired: false, statusCode: 201 });
    mockSubscriptions([]);
  });

  it("does nothing when VAPID is not configured", async () => {
    mocks.isWebPushConfigured.mockReturnValue(false);

    const summary = await sendPushToUser("user-1", message);

    expect(summary).toEqual({ sent: 0, failed: 0, pruned: 0 });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.sendWebPush).not.toHaveBeenCalled();
  });

  it("respects the user push preference in the subscription query", async () => {
    mockSubscriptions([subscription()]);

    await sendPushToUser("user-1", message);

    const select = executedSql().find((sql) => sql.includes("FROM push_subscriptions ps"));
    expect(select).toContain("u.push_notifications_enabled = TRUE");
    expect(select).toContain("u.deleted_at IS NULL");
  });

  it("delivers to every device and records successful use", async () => {
    mockSubscriptions([
      subscription({ id: "sub-1" }),
      subscription({ id: "sub-2", endpoint: "https://push.example.com/sub-2" }),
    ]);

    const summary = await sendPushToUser("user-1", message);

    expect(summary).toEqual({ sent: 2, failed: 0, pruned: 0 });
    expect(mocks.sendWebPush).toHaveBeenCalledTimes(2);
    expect(executedSql().filter((sql) => sql.includes("last_used_at = NOW()")).length).toBe(2);
  });

  it("prunes subscriptions the push service reports as gone", async () => {
    mockSubscriptions([subscription()]);
    mocks.sendWebPush.mockResolvedValue({ ok: false, expired: true, statusCode: 410 });

    const summary = await sendPushToUser("user-1", message);

    expect(summary).toEqual({ sent: 0, failed: 0, pruned: 1 });
    expect(executedSql().some((sql) => sql.startsWith("DELETE FROM push_subscriptions"))).toBe(
      true
    );
  });

  it("prunes subscriptions with undecodable keys", async () => {
    mockSubscriptions([subscription()]);
    mocks.sendWebPush.mockResolvedValue({
      ok: false,
      expired: false,
      error: "invalid_subscription",
    });

    const summary = await sendPushToUser("user-1", message);

    expect(summary.pruned).toBe(1);
    expect(executedSql().some((sql) => sql.startsWith("DELETE FROM push_subscriptions"))).toBe(
      true
    );
  });

  it("increments the failure counter for transient errors", async () => {
    mockSubscriptions([subscription({ failure_count: 1 })]);
    mocks.sendWebPush.mockResolvedValue({
      ok: false,
      expired: false,
      statusCode: 503,
      error: "push_service_503",
    });

    const summary = await sendPushToUser("user-1", message);

    expect(summary).toEqual({ sent: 0, failed: 1, pruned: 0 });
    const update = executedSql().find((sql) => sql.includes("failure_count = $2"));
    expect(update).toBeDefined();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("failure_count = $2"), [
      "sub-1",
      2,
    ]);
  });

  it("deletes a subscription once it reaches the failure threshold", async () => {
    mockSubscriptions([subscription({ failure_count: MAX_PUSH_FAILURES - 1 })]);
    mocks.sendWebPush.mockResolvedValue({
      ok: false,
      expired: false,
      statusCode: 500,
      error: "push_service_500",
    });

    const summary = await sendPushToUser("user-1", message);

    expect(summary.pruned).toBe(1);
    expect(executedSql().some((sql) => sql.startsWith("DELETE FROM push_subscriptions"))).toBe(
      true
    );
  });

  it("never throws when loading subscriptions fails", async () => {
    mocks.query.mockRejectedValue(new Error("db down"));

    await expect(sendPushToUser("user-1", message)).resolves.toEqual({
      sent: 0,
      failed: 0,
      pruned: 0,
    });
  });
});
