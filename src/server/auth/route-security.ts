import { NextResponse } from "next/server";
import type { AuthRateLimitKind } from "./rate-limit";
import { consumeAuthRateLimit } from "./rate-limit";
import { assertTrustedMutationOrigin, trustedClientIp, UntrustedMutationOriginError } from "./request-security";

export function mutationOriginError(request: Request): NextResponse | null {
  try {
    assertTrustedMutationOrigin(request);
    return null;
  } catch (error) {
    if (error instanceof UntrustedMutationOriginError) {
      return NextResponse.json({ message: "Request rejected." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
}

export async function consumeRequestLimits(
  request: Request,
  identifier: string,
  accountKind: AuthRateLimitKind,
  ipKind: AuthRateLimitKind,
): Promise<{ allowed: boolean; retryAfterSeconds: number; clientIp: string | null }> {
  const clientIp = trustedClientIp(request.headers);
  const account = await consumeAuthRateLimit(accountKind, identifier);
  const ip = clientIp ? await consumeAuthRateLimit(ipKind, clientIp) : null;
  return {
    allowed: account.allowed && (ip?.allowed ?? true),
    retryAfterSeconds: Math.max(account.retryAfterSeconds, ip?.retryAfterSeconds ?? 0),
    clientIp,
  };
}
