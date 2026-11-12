import { NextResponse } from "next/server";
import { hashPassword } from "@/modules/auth/password";
import { registrationSchema } from "@/modules/auth/validation";
import { getServerEnv } from "@/config/env";
import { recordAuthSecurityEvent } from "@/server/auth/events";
import { getAuthEmailDelivery } from "@/server/auth/email-delivery";
import { consumeRequestLimits, mutationOriginError } from "@/server/auth/route-security";
import { requestEmailVerification } from "@/server/auth/tokens";
import { getDatabase } from "@/server/db";
import { accountNotificationEvents, users } from "@/server/db/schema";

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
    createdUserId = await getDatabase().transaction(async (tx) => {
      const [created] = await tx.insert(users).values({
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        accountStatus: "pending",
      }).returning({ id: users.id });
      if (!created) return null;
      await tx.insert(accountNotificationEvents).values({
        targetUserId: created.id,
        eventType: "registration_pending",
        audience: "platform_admin",
      });
      return created.id;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const verification = await requestEmailVerification(parsed.data.email, { clientIp: rateLimit.clientIp });
  if (createdUserId) {
    const delivery = getAuthEmailDelivery();
    if (delivery) {
      try {
        const adminUrl = new URL("/app/admin/users?status=pending", getServerEnv().NEXTAUTH_URL).toString();
        await delivery.sendPendingRegistration({ email: parsed.data.email, name: parsed.data.name, adminUrl });
        await recordAuthSecurityEvent({ eventType: "pending_registration_notification", outcome: "delivered", userId: createdUserId, clientIp: rateLimit.clientIp });
      } catch {
        await recordAuthSecurityEvent({ eventType: "pending_registration_notification", outcome: "delivery_failed", userId: createdUserId, clientIp: rateLimit.clientIp });
      }
    }
  }
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
