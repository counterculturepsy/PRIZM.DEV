import { NextResponse } from "next/server";
import { passwordResetSchema } from "@/modules/auth/validation";
import { consumeAuthRateLimit } from "@/server/auth/rate-limit";
import { mutationOriginError } from "@/server/auth/route-security";
import { trustedClientIp } from "@/server/auth/request-security";
import { resetPasswordWithToken } from "@/server/auth/tokens";

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const parsed = passwordResetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "The reset request is invalid." }, { status: 400 });
  const limit = await consumeAuthRateLimit("password_reset_complete", parsed.data.token);
  if (!limit.allowed) return NextResponse.json({ message: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const reset = await resetPasswordWithToken(parsed.data.token, parsed.data.password, { clientIp: trustedClientIp(request.headers) });
  return reset
    ? NextResponse.json({ reset: true }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ message: "The reset link is invalid or expired." }, { status: 400, headers: { "Cache-Control": "no-store" } });
}
