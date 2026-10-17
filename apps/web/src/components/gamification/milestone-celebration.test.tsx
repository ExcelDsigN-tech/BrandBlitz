import { beforeEach, describe, expect, it, vi } from "vitest";
import confetti from "canvas-confetti";
import {
  triggerMilestoneCelebration,
  isCelebrationEnabled,
  setCelebrationEnabled,
} from "./milestone-celebration";

vi.mock("canvas-confetti", () => ({
  default: vi.fn(),
}));

describe("Milestone Celebratory Animations (#1029)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = "";
    // Default matchMedia: no reduced motion
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("fires confetti when reaching top-3 podium finish", () => {
    triggerMilestoneCelebration("podium", { rank: 1 });

    expect(confetti).toHaveBeenCalledTimes(1);
    expect(confetti).toHaveBeenCalledWith(
      expect.objectContaining({
        particleCount: 40,
        colors: expect.arrayContaining(["#ffd700"]), // Gold for rank 1
      })
    );
  });

  it("fires confetti when achieving a new personal best score", () => {
    triggerMilestoneCelebration("personal_best", { score: 1250 });

    expect(confetti).toHaveBeenCalledTimes(1);
    expect(confetti).toHaveBeenCalledWith(
      expect.objectContaining({
        particleCount: 35,
      })
    );
  });

  it("respects prefers-reduced-motion by suppressing animations", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    triggerMilestoneCelebration("podium", { rank: 2 });
    expect(confetti).not.toHaveBeenCalled();
  });

  it("respects user preference toggle when celebrations are disabled", () => {
    expect(isCelebrationEnabled()).toBe(true);

    setCelebrationEnabled(false);
    expect(isCelebrationEnabled()).toBe(false);

    triggerMilestoneCelebration("podium", { rank: 3 });
    expect(confetti).not.toHaveBeenCalled();

    setCelebrationEnabled(true);
    triggerMilestoneCelebration("podium", { rank: 3 });
    expect(confetti).toHaveBeenCalledTimes(1);
  });

  it("does not conflict when BadgeUnlockModal is already open", () => {
    const modalElement = document.createElement("div");
    modalElement.setAttribute("aria-label", "Badge unlocked");
    document.body.appendChild(modalElement);

    triggerMilestoneCelebration("podium", { rank: 1 });
    expect(confetti).not.toHaveBeenCalled();
  });
});
