import { sql, and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { passwordSchema } from "@/modules/auth/validation";
import { hashPassword } from "@/modules/auth/password";
import { authOptions } from "@/server/auth/options";
import { recordAuthSecurityEvent } from "@/server/auth/events";
import { consumeRequestLimits, mutationOriginError } from "@/server/auth/route-security";
import { getDatabase } from "@/server/db";
import { accounts, users } from "@/server/db/schema";

export async function POST(request: Request) {
  const originError = mutationOriginError(request);
  if (originError) return originError;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ message: "Authentication is required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { password?: unknown; confirmation?: unknown } | null;
  const parsed = passwordSchema.safeParse(body?.password);
  if (!parsed.success || body?.password !== body?.confirmation) {
    return NextResponse.json({ message: parsed.success ? "The passwords do not match." : parsed.error.issues[0]?.message ?? "Choose a stronger password." }, { status: 400 });
  }
  const rateLimit = await consumeRequestLimits(request, session.user.id, "password_setup", "password_setup_ip");
  if (!rateLimit.allowed) {
    await recordAuthSecurityEvent({ eventType: "password_login_established", outcome: "rate_limited", userId: session.user.id, clientIp: rateLimit.clientIp });
    return NextResponse.json({ message: "Too many password setup attempts. Try again later." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rateLimit.retryAfterSeconds) } });
  }
  const [eligible] = await getDatabase().select({ id: users.id })
    .from(users)
    .innerJoin(accounts, and(eq(accounts.userId, users.id), eq(accounts.type, "oauth")))
    .where(and(eq(users.id, session.user.id), eq(users.accountStatus, "approved"), sql`${users.passwordHash} is null`))
    .limit(1);
  if (!eligible) {
    await recordAuthSecurityEvent({ eventType: "password_login_established", outcome: "not_eligible", userId: session.user.id, clientIp: rateLimit.clientIp });
    return NextResponse.json({ message: "Password setup is unavailable for this account." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const passwordHash = await hashPassword(parsed.data);
  const now = new Date();
  const created = await getDatabase().transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, passwordHash: users.passwordHash, status: users.accountStatus })
      .from(users).where(eq(users.id, session.user.id)).limit(1).for("update");
    if (!user || user.status !== "approved" || user.passwordHash) return false;
    const [linkedProvider] = await tx.select({ userId: accounts.userId }).from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.type, "oauth"))).limit(1);
    if (!linkedProvider) return false;
    await tx.update(users).set({
      passwordHash,
      emailVerified: now,
      passwordChangedAt: now,
      authVersion: sql`${users.authVersion} + 1`,
      updatedAt: now,
    }).where(eq(users.id, user.id));
    return true;
  });
  await recordAuthSecurityEvent({ eventType: "password_login_established", outcome: created ? "success" : "not_eligible", userId: session.user.id, clientIp: rateLimit.clientIp });
  return created
    ? NextResponse.json({ created: true }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ message: "Password setup is unavailable for this account." }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
