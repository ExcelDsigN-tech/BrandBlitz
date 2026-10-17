"use client";

import confetti from "canvas-confetti";

export type MilestoneType = "podium" | "personal_best";

export function isCelebrationEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem("brandblitz:celebrations_enabled") !== "false";
  } catch {
    return true;
  }
}

export function setCelebrationEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("brandblitz:celebrations_enabled", enabled ? "true" : "false");
  } catch {
    // ignore
  }
}

export function triggerMilestoneCelebration(
  milestone: MilestoneType,
  info?: { rank?: number; score?: number }
): void {
  if (typeof window === "undefined") return;

  // 1. Respect prefers-reduced-motion
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  // 2. Respect user celebration preference toggle
  if (!isCelebrationEnabled()) {
    return;
  }

  // 3. Coordinate with BadgeUnlockModal (avoid visual conflict if modal is already open)
  const isBadgeModalOpen = Boolean(document.querySelector('[aria-label="Badge unlocked"]'));
  if (isBadgeModalOpen) {
    return;
  }

  // 4. Trigger lightweight confetti
  if (milestone === "podium") {
    const colors =
      info?.rank === 1
        ? ["#ffd700", "#ffea00", "#f59e0b"] // Gold
        : info?.rank === 2
          ? ["#c0c0c0", "#e2e8f0", "#94a3b8"] // Silver
          : ["#cd7f32", "#d97706", "#b45309"]; // Bronze

    try {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.65 },
        colors,
        ticks: 150,
      });
    } catch {
      // ignore in environments without canvas
    }
  } else {
    try {
      confetti({
        particleCount: 35,
        spread: 50,
        origin: { y: 0.7 },
        colors: ["#6366f1", "#3b82f6", "#10b981", "#ec4899"],
        ticks: 120,
      });
    } catch {
      // ignore
    }
  }
}
