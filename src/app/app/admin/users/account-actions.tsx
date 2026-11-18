"use client";

import { Button } from "@/components/ui/button";
import type { AccountStatus } from "@/server/admin/accounts";
import { updateAccountStatusAction } from "./actions";

const labels = {
  approve: "Approve",
  reject: "Reject",
  suspend: "Suspend",
  reactivate: "Reactivate",
} as const;

export function AccountActions({ userId, status, emailVerified }: { userId: string; status: AccountStatus; emailVerified: boolean }) {
  const actions = status === "pending" ? ["approve", "reject"] as const
    : status === "approved" ? ["suspend"] as const
      : ["reactivate"] as const;
  return <div className="flex flex-wrap gap-2">{actions.map((action) => (
    <form action={updateAccountStatusAction} key={action} onSubmit={(event) => {
      if (!window.confirm(`${labels[action]} this account? This change is recorded in the platform audit log.`)) event.preventDefault();
    }}>
      <input name="targetUserId" type="hidden" value={userId} />
      <input name="action" type="hidden" value={action} />
      <Button className="min-h-9 px-3 text-xs" disabled={action === "approve" && !emailVerified} title={action === "approve" && !emailVerified ? "Email verification is required before approval" : undefined} type="submit" variant={action === "approve" || action === "reactivate" ? "primary" : "secondary"}>{labels[action]}</Button>
    </form>
  ))}</div>;
}
