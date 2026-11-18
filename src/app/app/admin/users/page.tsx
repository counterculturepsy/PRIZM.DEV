import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form-controls";
import { AccountAdministrationError, countPendingAdminNotifications, listAccountsForAdministration, listApprovalHistory, requirePlatformAdmin, type AccountStatus } from "@/server/admin/accounts";
import { AccountActions } from "./account-actions";

export const metadata: Metadata = { title: "User approvals" };
export const dynamic = "force-dynamic";

const statuses = ["all", "pending", "approved", "rejected", "suspended"] as const;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  try { await requirePlatformAdmin(); } catch (error) { if (error instanceof AccountAdministrationError) notFound(); throw error; }
  const params = await searchParams;
  const status = statuses.includes(params.status as (typeof statuses)[number]) ? params.status as AccountStatus | "all" : "pending";
  const [accounts, history, pendingNotifications] = await Promise.all([
    listAccountsForAdministration({ query: params.q ?? "", status }),
    listApprovalHistory(),
    countPendingAdminNotifications(),
  ]);

  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-6 lg:px-8">
    <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Platform administration</p>
    <div className="mt-3 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold">Private account approvals</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Workspace roles never grant access here. Every decision is server-authorized and written to the immutable approval history.</p></div><span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary">{pendingNotifications} pending indicator{pendingNotifications === 1 ? "" : "s"}</span></div>
    <Card className="mt-8 p-5"><form className="grid gap-4 sm:grid-cols-[1fr_220px_auto]" method="get"><div className="grid gap-2"><Label htmlFor="admin-user-search">Search</Label><Input defaultValue={params.q ?? ""} id="admin-user-search" name="q" placeholder="Name or email" /></div><div className="grid gap-2"><Label htmlFor="admin-status">Status</Label><select className="min-h-10 rounded-xl border border-border bg-surface-elevated px-3 text-sm" defaultValue={status} id="admin-status" name="status">{statuses.map((value) => <option key={value} value={value}>{value[0]?.toUpperCase()}{value.slice(1)}</option>)}</select></div><button className="min-h-10 self-end rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground" type="submit">Apply filters</button></form></Card>
    <section className="mt-6 grid gap-3" aria-label="Accounts">{accounts.map((account) => <Card className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center" key={account.id}><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{account.name ?? "Unnamed account"}</h2><span className="rounded-full border border-border px-2.5 py-1 text-xs capitalize">{account.status}</span>{account.isPlatformAdmin ? <span className="rounded-full border border-cyan/30 bg-cyan/10 px-2.5 py-1 text-xs text-cyan">Platform administrator</span> : null}</div><p className="mt-1 text-sm text-muted-foreground">{account.email}</p><p className="mt-2 text-xs text-muted-foreground">Registered {account.createdAt.toLocaleString("en-ZA")} · Email {account.emailVerified ? "verified" : "not verified"}</p></div>{account.isPlatformAdmin ? <p className="text-xs text-muted-foreground">Protected from queue actions</p> : <AccountActions emailVerified={Boolean(account.emailVerified)} status={account.status} userId={account.id} />}</Card>)}{accounts.length === 0 ? <Card className="p-10 text-center text-sm text-muted-foreground">No accounts match these filters.</Card> : null}</section>
    <section className="mt-10"><h2 className="text-xl font-semibold">Approval history</h2><div className="mt-4 grid gap-3">{history.map((entry) => <Card className="p-4 text-sm" key={entry.id}><p><span className="font-medium capitalize">{entry.action}</span> · {entry.previousStatus} → {entry.nextStatus}</p><p className="mt-1 text-xs text-muted-foreground">By {entry.actorName ?? entry.actorEmail} · {entry.createdAt.toLocaleString("en-ZA")} · target {entry.targetUserId}</p></Card>)}{history.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No approval decisions have been recorded.</Card> : null}</div></section>
  </main>;
}
