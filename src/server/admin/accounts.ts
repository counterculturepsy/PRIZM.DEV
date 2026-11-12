import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db";
import { getServerEnv } from "@/config/env";
import { getAuthEmailDelivery, type AuthEmailDelivery } from "@/server/auth/email-delivery";
import { recordAuthSecurityEvent } from "@/server/auth/events";
import { accountApprovalAudits, accountNotificationEvents, users } from "@/server/db/schema";
import { requireSession } from "@/server/auth/session";

export type AccountStatus = "pending" | "approved" | "rejected" | "suspended";
export type AccountAction = "approve" | "reject" | "suspend" | "reactivate";

const transitions: Record<AccountAction, Readonly<{ from: readonly AccountStatus[]; to: AccountStatus; notification: string }>> = {
  approve: { from: ["pending"], to: "approved", notification: "account_approved" },
  reject: { from: ["pending"], to: "rejected", notification: "account_rejected" },
  suspend: { from: ["approved"], to: "suspended", notification: "account_suspended" },
  reactivate: { from: ["rejected", "suspended"], to: "approved", notification: "account_reactivated" },
};

export class AccountAdministrationError extends Error {}

export async function requirePlatformAdmin() {
  const session = await requireSession();
  const [admin] = await getDatabase()
    .select({ id: users.id, isPlatformAdmin: users.isPlatformAdmin, accountStatus: users.accountStatus })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!admin || !admin.isPlatformAdmin || admin.accountStatus !== "approved") {
    throw new AccountAdministrationError("Platform administrator access is required.");
  }
  return admin;
}

export async function listAccountsForAdministration(input: Readonly<{ query?: string; status?: AccountStatus | "all" }>) {
  const query = input.query?.trim().slice(0, 100) ?? "";
  const filters = [];
  if (input.status && input.status !== "all") filters.push(eq(users.accountStatus, input.status));
  if (query) filters.push(or(ilike(users.name, `%${query}%`), ilike(users.email, `%${query}%`))!);
  return getDatabase()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.accountStatus,
      isPlatformAdmin: users.isPlatformAdmin,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(100);
}

export async function listApprovalHistory() {
  return getDatabase()
    .select({
      id: accountApprovalAudits.id,
      action: accountApprovalAudits.action,
      previousStatus: accountApprovalAudits.previousStatus,
      nextStatus: accountApprovalAudits.nextStatus,
      createdAt: accountApprovalAudits.createdAt,
      actorName: users.name,
      actorEmail: users.email,
      targetUserId: accountApprovalAudits.targetUserId,
    })
    .from(accountApprovalAudits)
    .innerJoin(users, eq(users.id, accountApprovalAudits.actorUserId))
    .orderBy(desc(accountApprovalAudits.createdAt))
    .limit(50);
}

export async function countPendingAdminNotifications() {
  const [row] = await getDatabase()
    .select({ count: sql<number>`count(*)::int` })
    .from(accountNotificationEvents)
    .where(and(eq(accountNotificationEvents.audience, "platform_admin"), isNull(accountNotificationEvents.readAt)));
  return row?.count ?? 0;
}

export async function changeAccountStatus(
  actorUserId: string,
  targetUserId: string,
  action: AccountAction,
  deps: Readonly<{ delivery?: AuthEmailDelivery | null; baseUrl?: string }> = {},
): Promise<void> {
  if (actorUserId === targetUserId) throw new AccountAdministrationError("Administrators cannot change their own access state.");
  const transition = transitions[action];
  if (!transition) throw new AccountAdministrationError("Unsupported account action.");
  const now = new Date();

  const notificationTarget = await getDatabase().transaction(async (tx) => {
    const [actor] = await tx.select({ approved: users.accountStatus, admin: users.isPlatformAdmin })
      .from(users).where(eq(users.id, actorUserId)).limit(1).for("update");
    if (!actor?.admin || actor.approved !== "approved") throw new AccountAdministrationError("Platform administrator access is required.");

    const [target] = await tx.select({ status: users.accountStatus, isPlatformAdmin: users.isPlatformAdmin, email: users.email, name: users.name, emailVerified: users.emailVerified })
      .from(users).where(eq(users.id, targetUserId)).limit(1).for("update");
    if (!target) throw new AccountAdministrationError("The account no longer exists.");
    if (target.isPlatformAdmin) throw new AccountAdministrationError("Platform administrator access cannot be changed from this queue.");
    if (action === "approve" && !target.emailVerified) throw new AccountAdministrationError("Verify the account email before approving access.");
    if (!transition.from.includes(target.status)) throw new AccountAdministrationError("The account state changed. Refresh and try again.");

    const [updated] = await tx.update(users).set({
      accountStatus: transition.to,
      authVersion: sql`${users.authVersion} + 1`,
      updatedAt: now,
    }).where(and(eq(users.id, targetUserId), eq(users.accountStatus, target.status))).returning({ id: users.id });
    if (!updated) throw new AccountAdministrationError("The account state changed. Refresh and try again.");

    await tx.insert(accountApprovalAudits).values({
      actorUserId,
      targetUserId,
      action,
      previousStatus: target.status,
      nextStatus: transition.to,
      createdAt: now,
    });
    await tx.insert(accountNotificationEvents).values({
      actorUserId,
      targetUserId,
      eventType: transition.notification,
      audience: "user",
      createdAt: now,
    });
    await tx.update(accountNotificationEvents).set({ readAt: now }).where(and(
      eq(accountNotificationEvents.targetUserId, targetUserId),
      eq(accountNotificationEvents.audience, "platform_admin"),
      isNull(accountNotificationEvents.readAt),
    ));
    return { email: target.email, name: target.name, status: transition.to };
  });

  const delivery = deps.delivery === undefined ? getAuthEmailDelivery() : deps.delivery;
  if (!delivery) return;
  try {
    const status = notificationTarget.status === "approved" && action === "reactivate" ? "reactivated" : notificationTarget.status;
    if (status === "pending") return;
    await delivery.sendAccountStatus({
      email: notificationTarget.email,
      name: notificationTarget.name,
      status,
      loginUrl: new URL("/login", deps.baseUrl ?? getServerEnv().NEXTAUTH_URL).toString(),
    });
    await recordAuthSecurityEvent({ eventType: "account_status_notification", outcome: "delivered", userId: targetUserId, metadata: { status } });
  } catch {
    await recordAuthSecurityEvent({ eventType: "account_status_notification", outcome: "delivery_failed", userId: targetUserId, metadata: { status: notificationTarget.status } });
  }
}
