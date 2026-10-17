import { createHmac, timingSafeEqual } from "crypto";
import { config } from "./config";

export function computeSessionHmac(
  sessionId: string,
  totalScore: number,
  completedAt: string
): string {
  if (!config.SESSION_INTEGRITY_KEY) return "";
  return createHmac("sha256", config.SESSION_INTEGRITY_KEY)
    .update(`${sessionId}:${totalScore}:${completedAt}`)
    .digest("hex");
}

export function verifySessionHmac(
  sessionId: string,
  totalScore: number,
  completedAt: string,
  storedHmac: string | null | undefined
): boolean {
  if (!config.SESSION_INTEGRITY_KEY || !storedHmac) return true;
  const expected = computeSessionHmac(sessionId, totalScore, completedAt);
  if (!expected) return true;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(storedHmac, "hex"));
  } catch {
    return false;
  }
}
