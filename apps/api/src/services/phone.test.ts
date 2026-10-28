import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Twilio mock ────────────────────────────────────────────────────────────────

const mockCreateVerification = vi.fn();
const mockCreateCheck = vi.fn();

vi.mock("twilio", () => ({
  default: vi.fn(() => ({
    verify: {
      v2: {
        services: vi.fn(() => ({
          verifications: { create: mockCreateVerification },
          verificationChecks: { create: mockCreateCheck },
        })),
      },
    },
  })),
}));

import {
  sendVerificationCode,
  checkVerificationCode,
  hashPhoneNumber,
  requirePhoneVerified,
} from "./phone";

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("phone service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PHONE_HASH_SALT = "unit-test-phone-salt";
  });

  // ── hashPhoneNumber ──────────────────────────────────────────────────────────

  describe("hashPhoneNumber", () => {
    it("hashes the same phone number deterministically regardless of formatting", () => {
      const hashA = hashPhoneNumber("+1 (555) 123-4567");
      const hashB = hashPhoneNumber("+15551234567");
      expect(hashA).toBe(hashB);
      expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ── sendVerificationCode ─────────────────────────────────────────────────────

  describe("sendVerificationCode", () => {
    it("calls Twilio verify API with correct params", async () => {
      mockCreateVerification.mockResolvedValue({ sid: "123" });

      await sendVerificationCode("+15551234567");

      expect(mockCreateVerification).toHaveBeenCalledWith({
        to: "+15551234567",
        channel: "sms",
      });
    });

    it("surfaces Twilio errors", async () => {
      mockCreateVerification.mockRejectedValue(new Error("Twilio error"));

      await expect(sendVerificationCode("+15551234567")).rejects.toThrow("Twilio error");
    });
  });

  // ── checkVerificationCode ────────────────────────────────────────────────────

  describe("checkVerificationCode", () => {
    it("returns true when status is approved", async () => {
      mockCreateCheck.mockResolvedValue({ status: "approved" });

      const result = await checkVerificationCode("+15551234567", "123456");

      expect(result).toBe(true);
    });

    it("returns false when status is pending", async () => {
      mockCreateCheck.mockResolvedValue({ status: "pending" });

      const result = await checkVerificationCode("+15551234567", "123456");

      expect(result).toBe(false);
    });

    it("returns false when status is canceled", async () => {
      mockCreateCheck.mockResolvedValue({ status: "canceled" });

      const result = await checkVerificationCode("+15551234567", "123456");

      expect(result).toBe(false);
    });

    it("surfaces Twilio errors", async () => {
      mockCreateCheck.mockRejectedValue(new Error("Verification failed"));

      await expect(checkVerificationCode("+15551234567", "123456")).rejects.toThrow(
        "Verification failed"
      );
    });
  });

  // ── requirePhoneVerified ─────────────────────────────────────────────────────

  describe("requirePhoneVerified", () => {
    it("resolves when phone is verified", async () => {
      await expect(requirePhoneVerified("user1", true)).resolves.toBeUndefined();
    });

    it("throws when phone is not verified", async () => {
      await expect(requirePhoneVerified("user1", false)).rejects.toThrow(
        "Phone verification required"
      );
    });
  });
});
