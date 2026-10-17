import { headers } from "next/headers";

/**
 * Get the CSP nonce from the request headers
 * The nonce is set by the middleware and should be used in inline scripts
 *
 * Usage in Server Components:
 * const nonce = await getCspNonce();
 * <script nonce={nonce}>...</script>
 */
export async function getCspNonce(): Promise<string> {
  const headersList = await headers();
  return headersList.get("x-nonce") || "";
}
