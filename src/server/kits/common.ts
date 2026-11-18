import { hasCapability, type WorkspaceScope } from "@/modules/workspaces/scope";
import type { getDatabase } from "@/server/db";
import { auditLogs } from "@/server/db/schema";

export class KitError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "invalid" | "conflict" | "quota" | "not_approved", message: string) {
    super(message);
    this.name = "KitError";
  }
}

export function requireWrite(scope: WorkspaceScope): void {
  if (!hasCapability(scope, "write")) throw new KitError("forbidden", "Your workspace role cannot change capability kits.");
}

/** Approving content for external use is limited to owners and administrators. */
export function requireManage(scope: WorkspaceScope): void {
  if (!hasCapability(scope, "manage_workspace")) throw new KitError("forbidden", "Only a workspace owner or administrator can do this.");
}

type Database = ReturnType<typeof getDatabase>;
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function recordKitAudit(
  executor: Executor,
  actor: Pick<WorkspaceScope, "workspaceId" | "userId"> | { workspaceId: string; userId: null },
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await executor.insert(auditLogs).values({ workspaceId: actor.workspaceId, actorUserId: actor.userId, action: `kit.${action}`, targetType, targetId, metadata });
}
