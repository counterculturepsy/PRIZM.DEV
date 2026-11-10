import { and, eq } from "drizzle-orm";
import { serviceDetailsSchema } from "@/modules/workspaces/validation";
import { hasCapability, type WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import { auditLogs, services } from "@/server/db/schema";
import { tenantWhere } from "@/server/db/tenant";

export class ServiceDetailsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceDetailsError";
  }
}

/**
 * Updates only `description` and `features` of one service in the caller's workspace. Name, slug, active
 * status, prices and delivery time are never part of the update. Owners and admins only; the audit entry
 * records which fields changed plus a length and a count, never the text itself.
 */
export async function updateServiceDetails(scope: WorkspaceScope, input: unknown) {
  if (!hasCapability(scope, "manage_workspace")) throw new ServiceDetailsError("Only workspace owners and admins can edit service details.");
  const parsed = serviceDetailsSchema.safeParse(input);
  if (!parsed.success) throw new ServiceDetailsError(parsed.error.issues[0]?.message ?? "Check the service details.");
  const { serviceId, description, features } = parsed.data;

  return getDatabase().transaction(async (tx) => {
    const [current] = await tx.select({ id: services.id, description: services.description, features: services.features }).from(services)
      .where(and(tenantWhere(services.workspaceId, scope), eq(services.id, serviceId))).limit(1);
    if (!current) throw new ServiceDetailsError("That service does not belong to this workspace.");

    const changed = [
      current.description === description ? null : "description",
      JSON.stringify(current.features) === JSON.stringify(features) ? null : "features",
    ].filter((field): field is "description" | "features" => field !== null);
    if (changed.length === 0) return { changed: false as const };

    await tx.update(services).set({ description, features, updatedAt: new Date() })
      .where(and(tenantWhere(services.workspaceId, scope), eq(services.id, current.id)));
    await tx.insert(auditLogs).values({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "service.details_updated",
      targetType: "service",
      targetId: current.id,
      metadata: { changed, descriptionLength: description.length, featureCount: features.length },
    });
    return { changed: true as const, fields: changed };
  });
}
