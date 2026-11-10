import { NextResponse } from "next/server";
import { hashPassword } from "@/modules/auth/password";
import { registrationSchema } from "@/modules/auth/validation";
import { getServerEnv } from "@/config/env";
import { recordAuthSecurityEvent } from "@/server/auth/events";
import { consumeRequestLimits, mutationOriginError } from "@/server/auth/route-security";
import { requestEmailVerification } from "@/server/auth/tokens";
import { getDatabase } from "@/server/db";
import { users } from "@/server/db/schema";

export async function POST(request: Request) {
  if (!getServerEnv().PASSWORD_AUTH_ENABLED) {
    return NextResponse.json({ message: "Account creation is unavailable." }, { status: 404 });
  }
  const originError = mutationOriginError(request);
  if (originError) return originError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Check your account details." }, { status: 400 });
  }

  const rateLimit = await consumeRequestLimits(request, parsed.data.email, "registration", "registration_ip");
  if (!rateLimit.allowed) {
    await recordAuthSecurityEvent({ eventType: "registration", outcome: "rate_limited", identifier: parsed.data.email, clientIp: rateLimit.clientIp });
    return NextResponse.json(
      { message: "Too many account-creation attempts. Try again later." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);
  let createdUserId: string | null = null;
  try {
    const [created] = await getDatabase().insert(users).values({
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
    }).returning({ id: users.id });
    createdUserId = created?.id ?? null;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const verification = await requestEmailVerification(parsed.data.email, { clientIp: rateLimit.clientIp });
  await recordAuthSecurityEvent({
    eventType: "registration",
    outcome: createdUserId ? "created" : "accepted_existing",
    userId: createdUserId,
    identifier: parsed.data.email,
    clientIp: rateLimit.clientIp,
  });
  return NextResponse.json(
    { accepted: true, verificationRequired: true, deliveryAvailable: verification.deliveryAvailable },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const cause = "cause" in error ? error.cause : error;
  return Boolean(cause && typeof cause === "object" && "code" in cause && cause.code === "23505");
}
