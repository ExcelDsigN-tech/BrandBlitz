import { createHash } from "crypto";

export function computeFingerprint(params: {
  visitorId: string | undefined;
  deviceId: string | undefined;
  ip: string | undefined;
  userAgent: string | undefined;
}): string {
  const { visitorId, deviceId, ip, userAgent } = params;

  // Combine both client-supplied IDs — rotating just one doesn't escape the fingerprint
  const clientSig = `${visitorId ?? ""}|${deviceId ?? ""}`;
  // 24-bit prefix collapses NAT siblings without exposing the full address
  const ip24 = ip ? ip.split(".").slice(0, 3).join(".") : "";
  const uaHash = createHash("sha256")
    .update(userAgent ?? "")
    .digest("hex")
    .slice(0, 8);

  return createHash("sha256").update(`${clientSig}:${ip24}:${uaHash}`).digest("hex");
}
