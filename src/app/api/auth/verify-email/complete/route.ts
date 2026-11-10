import { NextResponse } from "next/server";
import { authActionTokenSchema } from "@/modules/auth/validation";
import { consumeAuthRateLimit } from "@/server/auth/rate-limit";
import { mutationOriginError } from "@/server/auth/route-security";
import { trustedClientIp } from "@/server/auth/request-security";
import { verifyEmailToken } from "@/server/auth/tokens";

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  const parsed = authActionTokenSchema.safeParse(body?.token);
  if (!parsed.success) return NextResponse.json({ message: "The verification link is invalid or expired." }, { status: 400 });
  const limit = await consumeAuthRateLimit("verification_complete", parsed.data);
  if (!limit.allowed) return NextResponse.json({ message: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const verified = await verifyEmailToken(parsed.data, { clientIp: trustedClientIp(request.headers) });
  return verified
    ? NextResponse.json({ verified: true }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ message: "The verification link is invalid or expired." }, { status: 400, headers: { "Cache-Control": "no-store" } });
}
