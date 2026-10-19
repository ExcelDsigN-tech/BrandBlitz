import { ImageResponse } from "next/og";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export const DEFAULT_PRIMARY_COLOR = "#0f172a";
export const DEFAULT_SECONDARY_COLOR = "#22d3ee";
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB
export const LOGO_FETCH_TIMEOUT_MS = 2500;

/** Escape HTML special characters before interpolating into Satori JSX (#361). */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strictly validate hex color format (#RRGGBB).
 * Fall back to the default theme if null, undefined, or malformed.
 */
export function validateHexColor(color: unknown, fallback: string): string {
  if (typeof color === "string" && HEX_COLOR_REGEX.test(color.trim())) {
    return color.trim().toLowerCase();
  }
  return fallback;
}

/**
 * Strictly validate logo URL, apply fetch timeout (2500ms) and size limit (max 2MB),
 * falling back gracefully on timeout, oversized file, or non-image content type.
 */
export async function validateAndFetchLogo(
  logoUrl: string | null | undefined
): Promise<string | null> {
  if (!logoUrl || typeof logoUrl !== "string") return null;

  try {
    const parsed = new URL(logoUrl);
    // Only permit https: (or http: on localhost in test/dev)
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(isLocalhost && parsed.protocol === "http:")) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);

    const res = await fetch(logoUrl, {
      signal: controller.signal,
      headers: { Accept: "image/png,image/jpeg,image/webp,image/svg+xml" },
    }).catch(() => null);

    clearTimeout(timeoutId);

    if (!res || !res.ok) return null;

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const allowedMimes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    const matchesAllowed = allowedMimes.some((mime) => contentType.includes(mime));
    if (!matchesAllowed) return null;

    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_LOGO_BYTES) {
      return null;
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_LOGO_BYTES) {
      return null;
    }

    const base64 = Buffer.from(buffer).toString("base64");
    const cleanMime = contentType.split(";")[0].trim() || "image/png";
    return `data:${cleanMime};base64,${base64}`;
  } catch {
    return null;
  }
}

export interface ResolvedOgBranding {
  brandName: string;
  safeBrandName: string;
  prizePool: string;
  safePrizePool: string;
  primaryColor: string;
  secondaryColor: string;
  logoDataUrl: string | null;
}

/**
 * Resolve and strictly validate all branding inputs from challenge data and query params.
 */
export async function resolveOgBranding(
  challenge: any,
  searchParams?: URLSearchParams
): Promise<ResolvedOgBranding> {
  const rawBrandName = searchParams?.get("brand_name") || challenge?.brand_name || "BrandBlitz";
  const rawPrizePool = searchParams?.get("pool_amount") || challenge?.pool_amount_usdc || "0";
  const rawPrimary = searchParams?.get("primary_color") || challenge?.primary_color;
  const rawSecondary = searchParams?.get("secondary_color") || challenge?.secondary_color;
  const rawLogoUrl = searchParams?.get("logo_url") || challenge?.logo_url;

  const brandName = typeof rawBrandName === "string" ? rawBrandName.slice(0, 50) : "BrandBlitz";
  const prizePool = typeof rawPrizePool === "string" ? rawPrizePool.slice(0, 20) : "0";

  const primaryColor = validateHexColor(rawPrimary, DEFAULT_PRIMARY_COLOR);
  const secondaryColor = validateHexColor(rawSecondary, DEFAULT_SECONDARY_COLOR);

  const logoDataUrl = await validateAndFetchLogo(rawLogoUrl);

  return {
    brandName,
    safeBrandName: escapeHtml(brandName),
    prizePool,
    safePrizePool: escapeHtml(prizePool),
    primaryColor,
    secondaryColor,
    logoDataUrl,
  };
}

/** 1×1 transparent PNG returned when OG generation fails unexpectedly (#361). */
function fallbackResponse(): NextResponse {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  return new NextResponse(png, {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=60" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  let challengeData: any = null;

  if (id !== "preview") {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost/api";
      const res = await fetch(`${apiUrl}/challenges/${id}`, { next: { revalidate: 60 } });
      if (res.ok) {
        const data = await res.json();
        challengeData = data.challenge;
      }
    } catch {
      // Fall back to defaults
    }
  }

  const searchParams = req.nextUrl?.searchParams ?? new URL(req.url).searchParams;
  const branding = await resolveOgBranding(challengeData, searchParams);

  try {
    return new ImageResponse(
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: `linear-gradient(135deg, ${branding.primaryColor} 0%, #0f172a 60%, ${branding.secondaryColor} 100%)`,
          fontFamily: "sans-serif",
          padding: "48px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            borderRadius: "24px",
            border: `2px solid ${branding.secondaryColor}`,
            padding: "48px 64px",
            maxWidth: "1000px",
            width: "100%",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          }}
        >
          {branding.logoDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoDataUrl}
              alt={branding.safeBrandName}
              width={88}
              height={88}
              style={{ borderRadius: "50%", marginBottom: "20px", objectFit: "cover" }}
            />
          )}
          <div
            style={{
              fontSize: 48,
              fontWeight: 800,
              color: "#f8fafc",
              textAlign: "center",
              lineHeight: 1.2,
            }}
          >
            {branding.safeBrandName} Challenge
          </div>
          <div
            style={{
              fontSize: 32,
              color: branding.secondaryColor,
              marginTop: "16px",
              fontWeight: 700,
            }}
          >
            Win {branding.safePrizePool} USDC
          </div>
          <div
            style={{
              fontSize: 18,
              color: "#94a3b8",
              marginTop: "12px",
              textAlign: "center",
            }}
          >
            Compete in a 45-second brand challenge. Top players win USDC instantly.
          </div>
          <div
            style={{
              marginTop: "28px",
              fontSize: 14,
              letterSpacing: "1px",
              color: "#64748b",
              textTransform: "uppercase",
            }}
          >
            brandblitz.gg
          </div>
        </div>
      </div>,
      { width: 1200, height: 630 }
    );
  } catch {
    // Satori render failed — return a 1×1 transparent PNG so link previews
    // don't get a 500 and crawlers don't retry aggressively (#361).
    return fallbackResponse();
  }
}
