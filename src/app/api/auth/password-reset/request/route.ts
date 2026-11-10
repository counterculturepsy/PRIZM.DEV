import { NextResponse } from "next/server";
import { emailSchema } from "@/modules/auth/validation";
import { getServerEnv } from "@/config/env";
import { consumeRequestLimits, mutationOriginError } from "@/server/auth/route-security";
import { requestPasswordReset } from "@/server/auth/tokens";

export async function POST(request: Request) {
  if (!getServerEnv().PASSWORD_AUTH_ENABLED) return NextResponse.json({ message: "Unavailable." }, { status: 404 });
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const parsed = emailSchema.safeParse(body?.email);
  if (!parsed.success) return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  const limit = await consumeRequestLimits(request, parsed.data, "password_reset", "password_reset_ip");
  if (!limit.allowed) return NextResponse.json({ message: "Too many requests. Try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(limit.retryAfterSeconds) } });
  const result = await requestPasswordReset(parsed.data, { clientIp: limit.clientIp });
  return NextResponse.json({ accepted: true, deliveryAvailable: result.deliveryAvailable }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
