import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("../db", () => ({
  query: mockQuery,
}));

vi.mock("../db/index", () => ({
  query: mockQuery,
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getBrandActiveEscrowBalanceUsdc,
  checkBrandBudgetThreshold,
  checkAllBrandsBudgetThresholds,
} from "./budget-alerts";

describe("Spend Budget Alerts Service (#1003)", () => {
  const brandId = "brand-123";

  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("getBrandActiveEscrowBalanceUsdc", () => {
    it("sums pool amount of active challenges in USDC", async () => {
      // 100 USDC = 1,000,000,000 stroops
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_stroops: "1000000000" }],
      });

      const balance = await getBrandActiveEscrowBalanceUsdc(brandId);
      expect(balance).toBe(100);
    });

    it("returns 0 if no active challenges", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const balance = await getBrandActiveEscrowBalanceUsdc(brandId);
      expect(balance).toBe(0);
    });
  });

  describe("checkBrandBudgetThreshold", () => {
    it("returns null if brand has no budget threshold set", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: brandId,
            name: "Acme",
            owner_user_id: "user-owner",
            budget_threshold: null,
            budget_alert_sent: false,
          },
        ],
      });

      const result = await checkBrandBudgetThreshold(brandId);
      expect(result).toBeNull();
    });

    it("resets budget_alert_sent = FALSE if balance is topped up above threshold", async () => {
      // Query 1: fetch brand
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: brandId,
            name: "Acme",
            owner_user_id: "user-owner",
            budget_threshold: "50.00",
            budget_alert_sent: true,
          },
        ],
      });
      // Query 2: getBrandActiveEscrowBalanceUsdc -> 100 USDC (1,000,000,000 stroops)
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_stroops: "1000000000" }],
      });
      // Query 3: UPDATE brands SET budget_alert_sent = FALSE
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await checkBrandBudgetThreshold(brandId);
      expect(result?.alertTriggered).toBe(false);
      expect(result?.alreadySent).toBe(false);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("budget_alert_sent = FALSE"), [
        brandId,
      ]);
    });

    it("triggers alert and creates notification when balance drops below threshold", async () => {
      // Query 1: fetch brand
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: brandId,
            name: "Acme",
            owner_user_id: "user-owner",
            budget_threshold: "100.00",
            budget_alert_sent: false,
          },
        ],
      });
      // Query 2: getBrandActiveEscrowBalanceUsdc -> 25 USDC (250,000,000 stroops)
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_stroops: "250000000" }],
      });
      // Query 3: INSERT into brand_notifications
      mockQuery.mockResolvedValueOnce({ rows: [{ id: "notif-1" }] });
      // Query 4: UPDATE brands SET budget_alert_sent = TRUE
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const result = await checkBrandBudgetThreshold(brandId);
      expect(result?.alertTriggered).toBe(true);
      expect(result?.alreadySent).toBe(false);
      expect(result?.currentEscrowBalanceUsdc).toBe(25);
      expect(result?.budgetThreshold).toBe(100);

      // Verify notification inserted
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO brand_notifications"),
        expect.arrayContaining([brandId, "user-owner"])
      );

      // Verify alert flag set to true
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("budget_alert_sent = TRUE"), [
        brandId,
      ]);
    });

    it("prevents duplicate alerts when balance remains below threshold", async () => {
      // Query 1: fetch brand (already sent)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: brandId,
            name: "Acme",
            owner_user_id: "user-owner",
            budget_threshold: "100.00",
            budget_alert_sent: true,
          },
        ],
      });
      // Query 2: getBrandActiveEscrowBalanceUsdc -> 20 USDC
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_stroops: "200000000" }],
      });

      const result = await checkBrandBudgetThreshold(brandId);
      expect(result?.alertTriggered).toBe(false);
      expect(result?.alreadySent).toBe(true);
      // No notification inserted
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO brand_notifications"),
        expect.anything()
      );
    });
  });

  describe("checkAllBrandsBudgetThresholds", () => {
    it("iterates all brands with budget_threshold configured", async () => {
      // Query 1: list brands with budget_threshold
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "b1" }],
      });

      // b1: fetch brand
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "b1",
            name: "Acme 1",
            owner_user_id: "user-1",
            budget_threshold: "50.00",
            budget_alert_sent: false,
          },
        ],
      });
      // b1: getBrandActiveEscrowBalanceUsdc -> 10 USDC (below 50)
      mockQuery.mockResolvedValueOnce({
        rows: [{ total_stroops: "100000000" }],
      });
      // b1: notif insert
      mockQuery.mockResolvedValueOnce({ rows: [{ id: "notif-b1" }] });
      // b1: update alert flag
      mockQuery.mockResolvedValueOnce({ rowCount: 1 });

      const results = await checkAllBrandsBudgetThresholds();
      expect(results).toHaveLength(1);
      expect(results[0]?.alertTriggered).toBe(true);
    });
  });
});
