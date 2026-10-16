import { ImageResponse } from "next/og";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

/** Escape HTML special characters before interpolating into Satori JSX (#361). */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 1×1 transparent PNG returned when OG generation fails or the result isn't shareable. */
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

/**
 * GET /api/og/result/[sessionId]
 * Shareable result-card image for a completed challenge session (#1011).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost/api";
  const res = await fetch(`${apiUrl}/sessions/${sessionId}/share-card`, {
    next: { revalidate: 300 },
  }).catch(() => null);

  if (!res || !res.ok) {
    return fallbackResponse();
  }

  const card = await res.json();
  const safeBrandName = escapeHtml(card.brandName ?? "BrandBlitz");
  const safeDisplayName = escapeHtml(
    card.player?.displayName ?? card.player?.username ?? "A player"
  );

  try {
    return new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            background: `linear-gradient(135deg, ${card.primaryColor ?? "#0f172a"} 0%, ${
              card.secondaryColor ?? "#1e293b"
            } 100%)`,
            fontFamily: "sans-serif",
            padding: "48px",
          }}
        >
          {card.logoUrl && (
            // next/image can't render inside Satori's ImageResponse
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.logoUrl}
              alt={safeBrandName}
              width={64}
              height={64}
              style={{ borderRadius: "50%", marginBottom: "20px", objectFit: "cover" }}
            />
          )}
          <div style={{ fontSize: 24, color: "#cbd5e1", fontWeight: 600 }}>{safeBrandName}</div>
          <div style={{ fontSize: 72, fontWeight: 700, color: "#f8fafc", marginTop: "12px" }}>
            {card.totalScore}
          </div>
          <div style={{ fontSize: 24, color: "#94a3b8", marginTop: "4px" }}>points</div>
          {card.rank && (
            <div style={{ fontSize: 28, color: "#22d3ee", marginTop: "20px", fontWeight: 600 }}>
              Rank #{card.rank}
            </div>
          )}
          <div style={{ fontSize: 20, color: "#f8fafc", marginTop: "24px" }}>
            {safeDisplayName}&apos;s result
          </div>
          <div style={{ marginTop: "32px", fontSize: 14, color: "#475569" }}>brandblitz.gg</div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  } catch {
    // Satori render failed — return a 1×1 transparent PNG so link previews
    // don't get a 500 and crawlers don't retry aggressively (#361).
    return fallbackResponse();
  }
}
