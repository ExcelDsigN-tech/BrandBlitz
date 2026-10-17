import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  escapeHtml,
  validateHexColor,
  validateAndFetchLogo,
  resolveOgBranding,
  GET,
} from "./[id]/route";

vi.mock("next/og", () => ({
  ImageResponse: vi.fn().mockImplementation((element, options) => ({
    status: 200,
    element,
    options,
    headers: new Headers({ "content-type": "image/png" }),
  })),
}));

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return new Uint8Array(buffer).buffer;
}

describe("Brand OG Social Preview (#1022)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateHexColor", () => {
    it("accepts valid 6-digit hex color strings", () => {
      expect(validateHexColor("#8b5cf6", DEFAULT_PRIMARY_COLOR)).toBe("#8b5cf6");
      expect(validateHexColor("#EC4899", DEFAULT_SECONDARY_COLOR)).toBe("#ec4899");
      expect(validateHexColor("#000000", DEFAULT_PRIMARY_COLOR)).toBe("#000000");
      expect(validateHexColor("#ffffff", DEFAULT_PRIMARY_COLOR)).toBe("#ffffff");
    });

    it("rejects malformed or invalid color strings and falls back safely", () => {
      expect(validateHexColor("#xyz123", DEFAULT_PRIMARY_COLOR)).toBe(DEFAULT_PRIMARY_COLOR);
      expect(validateHexColor("red", DEFAULT_PRIMARY_COLOR)).toBe(DEFAULT_PRIMARY_COLOR);
      expect(validateHexColor("rgb(0,0,0)", DEFAULT_PRIMARY_COLOR)).toBe(DEFAULT_PRIMARY_COLOR);
      expect(validateHexColor("#123", DEFAULT_PRIMARY_COLOR)).toBe(DEFAULT_PRIMARY_COLOR);
      expect(validateHexColor("#12345678", DEFAULT_PRIMARY_COLOR)).toBe(DEFAULT_PRIMARY_COLOR);
      expect(validateHexColor("<script>alert(1)</script>", DEFAULT_PRIMARY_COLOR)).toBe(
        DEFAULT_PRIMARY_COLOR
      );
      expect(validateHexColor(null, DEFAULT_PRIMARY_COLOR)).toBe(DEFAULT_PRIMARY_COLOR);
      expect(validateHexColor(undefined, DEFAULT_PRIMARY_COLOR)).toBe(DEFAULT_PRIMARY_COLOR);
      expect(validateHexColor(123456, DEFAULT_PRIMARY_COLOR)).toBe(DEFAULT_PRIMARY_COLOR);
    });
  });

  describe("escapeHtml", () => {
    it("escapes special HTML characters to prevent XSS in Satori JSX", () => {
      expect(escapeHtml("Acme & Sons <Gaming> \"Big\" 'Deal'")).toBe(
        "Acme &amp; Sons &lt;Gaming&gt; &quot;Big&quot; &#39;Deal&#39;"
      );
    });
  });

  describe("validateAndFetchLogo", () => {
    it("fetches and encodes valid image under 2MB into base64 data url", async () => {
      const mockImageBuffer = Buffer.from("fake-png-data");
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          "content-type": "image/png",
          "content-length": String(mockImageBuffer.byteLength),
        }),
        arrayBuffer: async () => toArrayBuffer(mockImageBuffer),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await validateAndFetchLogo("https://cdn.brandblitz.io/brand-logo.png");
      expect(result).toBe(`data:image/png;base64,${mockImageBuffer.toString("base64")}`);
    });

    it("rejects non-https URLs (except localhost)", async () => {
      const result = await validateAndFetchLogo("javascript:alert(1)");
      expect(result).toBeNull();

      const ftpResult = await validateAndFetchLogo("ftp://files.example.com/logo.png");
      expect(ftpResult).toBeNull();
    });

    it("rejects non-image content types (e.g. text/html)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        arrayBuffer: async () => toArrayBuffer(Buffer.from("<html>not an image</html>")),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await validateAndFetchLogo("https://example.com/not-image");
      expect(result).toBeNull();
    });

    it("rejects logos larger than 2MB limit", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          "content-type": "image/png",
          "content-length": String(3 * 1024 * 1024), // 3MB > 2MB limit
        }),
        arrayBuffer: async () => toArrayBuffer(Buffer.alloc(3 * 1024 * 1024)),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await validateAndFetchLogo("https://example.com/oversized-logo.png");
      expect(result).toBeNull();
    });

    it("falls back to null gracefully on network failure or timeout", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
      vi.stubGlobal("fetch", mockFetch);

      const result = await validateAndFetchLogo("https://example.com/timeout-logo.png");
      expect(result).toBeNull();
    });
  });

  describe("resolveOgBranding", () => {
    it("resolves branded colors and logo from challenge data", async () => {
      const mockImageBuffer = Buffer.from("logo-bytes");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          headers: new Headers({ "content-type": "image/webp" }),
          arrayBuffer: async () => toArrayBuffer(mockImageBuffer),
        })
      );

      const challenge = {
        brand_name: "CyberPunk Energy",
        pool_amount_usdc: "500",
        primary_color: "#7c3aed",
        secondary_color: "#06b6d4",
        logo_url: "https://cdn.brandblitz.io/cyberpunk.webp",
      };

      const branding = await resolveOgBranding(challenge);

      expect(branding.brandName).toBe("CyberPunk Energy");
      expect(branding.primaryColor).toBe("#7c3aed");
      expect(branding.secondaryColor).toBe("#06b6d4");
      expect(branding.prizePool).toBe("500");
      expect(branding.logoDataUrl).toBe(
        `data:image/webp;base64,${mockImageBuffer.toString("base64")}`
      );
    });

    it("falls back to default theme when brand kit is missing", async () => {
      const branding = await resolveOgBranding(null);

      expect(branding.brandName).toBe("BrandBlitz");
      expect(branding.primaryColor).toBe(DEFAULT_PRIMARY_COLOR);
      expect(branding.secondaryColor).toBe(DEFAULT_SECONDARY_COLOR);
      expect(branding.prizePool).toBe("0");
      expect(branding.logoDataUrl).toBeNull();
    });

    it("rejects malformed colors and falls back to default palette", async () => {
      const challenge = {
        brand_name: "Faulty Colors Brand",
        primary_color: "not-a-color",
        secondary_color: "#123", // 3-digit shorthand not permitted
      };

      const branding = await resolveOgBranding(challenge);

      expect(branding.primaryColor).toBe(DEFAULT_PRIMARY_COLOR);
      expect(branding.secondaryColor).toBe(DEFAULT_SECONDARY_COLOR);
    });

    it("allows query parameter overrides for live preview mode", async () => {
      const searchParams = new URLSearchParams({
        brand_name: "Overridden Brand",
        primary_color: "#10b981",
        secondary_color: "#f59e0b",
        pool_amount: "250",
      });

      const branding = await resolveOgBranding(null, searchParams);

      expect(branding.brandName).toBe("Overridden Brand");
      expect(branding.primaryColor).toBe("#10b981");
      expect(branding.secondaryColor).toBe("#f59e0b");
      expect(branding.prizePool).toBe("250");
    });
  });

  describe("GET /api/og/challenge/[id]", () => {
    it("renders branded OG image response for challenge", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          if (url.includes("/challenges/")) {
            return Promise.resolve({
              ok: true,
              json: async () => ({
                challenge: {
                  brand_name: "Stellar Brand",
                  pool_amount_usdc: "1000",
                  primary_color: "#2563eb",
                  secondary_color: "#38bdf8",
                  logo_url: null,
                },
              }),
            });
          }
          return Promise.resolve({ ok: false });
        })
      );

      const req = new NextRequest("http://localhost:3000/api/og/challenge/c-123");
      const res = await GET(req, { params: Promise.resolve({ id: "c-123" }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
    });

    it("handles preview id without calling challenge API", async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const req = new NextRequest(
        "http://localhost:3000/api/og/challenge/preview?brand_name=TestBrand&primary_color=%236366f1"
      );
      const res = await GET(req, { params: Promise.resolve({ id: "preview" }) });

      expect(res.status).toBe(200);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("falls back to 1x1 transparent PNG when ImageResponse throws", async () => {
      const { ImageResponse } = await import("next/og");
      (ImageResponse as any).mockImplementationOnce(() => {
        throw new Error("Satori rendering error");
      });

      const req = new NextRequest("http://localhost:3000/api/og/challenge/c-fail");
      const res = await GET(req, { params: Promise.resolve({ id: "c-fail" }) });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
    });
  });
});
