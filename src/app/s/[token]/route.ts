import { consumeAuthRateLimit } from "@/server/auth/rate-limit";
import { trustedClientIp } from "@/server/auth/request-security";
import { downloadResponse, hashClientIp, rateLimitedResponse, unavailableResponse } from "@/server/kits/http";
import { resolveShareDownload } from "@/server/kits/packs";

/**
 * Public, token-only download of an approved pack's PDF. The token is 256 bits, only its hash is stored, and every
 * refusal (unknown, malformed, expired, revoked, over its download limit, or content changed) is the same 404.
 * Requests are rate limited per client address before any lookup happens.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clientIp = trustedClientIp(request.headers);
  if (clientIp) {
    const limit = await consumeAuthRateLimit("kit_share_ip", clientIp);
    if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
  }
  const result = await resolveShareDownload(token, { ipHash: hashClientIp(clientIp) });
  if (!result.ok) return unavailableResponse();
  return downloadResponse({ bytes: result.bytes, filename: result.filename, contentType: "application/pdf", inline: false });
}
