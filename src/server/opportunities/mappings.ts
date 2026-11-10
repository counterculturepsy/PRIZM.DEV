import { and, asc, eq } from "drizzle-orm";
import { opportunityTypeLabels, opportunityTypes, type OpportunityType } from "@/modules/opportunities/generator";
import { assessPrice, type PriceStatus } from "@/modules/opportunities/mapping";
import { hasCapability, type WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import { auditLogs, opportunityServiceMappings, services, workspaces } from "@/server/db/schema";
import { tenantWhere } from "@/server/db/tenant";

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

type Database = ReturnType<typeof getDatabase>;
type Executor = Pick<Database, "select">;

function requireManager(scope: WorkspaceScope) {
  if (!hasCapability(scope, "manage_workspace")) throw new MappingError("Only workspace owners and admins can change service mappings.");
}

function requireType(value: string): OpportunityType {
  const type = opportunityTypes.find((candidate) => candidate === value);
  if (!type) throw new MappingError("Choose a supported opportunity type.");
  return type;
}

/** All explicit mappings for one workspace; used by opportunity generation. */
export function loadWorkspaceMappings(executor: Executor, workspaceId: string) {
  return executor.select({
    opportunityType: opportunityServiceMappings.opportunityType,
    serviceId: opportunityServiceMappings.serviceId,
    isPreferred: opportunityServiceMappings.isPreferred,
  }).from(opportunityServiceMappings).where(eq(opportunityServiceMappings.workspaceId, workspaceId));
}

export type MappingOverviewService = Readonly<{
  serviceId: string;
  serviceName: string;
  active: boolean;
  isPreferred: boolean;
  priceStatus: PriceStatus;
  startingPriceMinor: number | null;
  averagePriceMinor: number | null;
}>;

export type MappingOverviewType = Readonly<{
  type: OpportunityType;
  label: string;
  services: MappingOverviewService[];
  /** Mapped and active: the services that would be recommended for new opportunities. */
  effectiveCount: number;
}>;

export async function getMappingOverview(scope: WorkspaceScope) {
  const db = getDatabase();
  const [catalogue, mappings, [workspace]] = await Promise.all([
    db.select().from(services).where(tenantWhere(services.workspaceId, scope)).orderBy(asc(services.name), asc(services.id)),
    loadWorkspaceMappings(db, scope.workspaceId),
    db.select({ currency: workspaces.currency }).from(workspaces).where(eq(workspaces.id, scope.workspaceId)).limit(1),
  ]);
  const byId = new Map(catalogue.map((service) => [service.id, service]));
  const types: MappingOverviewType[] = opportunityTypes.map((type) => {
    const mapped = mappings
      .filter((mapping) => mapping.opportunityType === type)
      .flatMap((mapping) => {
        const service = byId.get(mapping.serviceId);
        if (!service) return [];
        const price = assessPrice(service);
        return [{
          serviceId: service.id,
          serviceName: service.name,
          active: service.active,
          isPreferred: mapping.isPreferred,
          priceStatus: price.status,
          startingPriceMinor: price.minimum,
          averagePriceMinor: price.maximum,
        }];
      })
      .sort((left, right) => Number(right.isPreferred) - Number(left.isPreferred) || left.serviceName.localeCompare(right.serviceName, "en") || left.serviceId.localeCompare(right.serviceId));
    return { type, label: opportunityTypeLabels[type], services: mapped, effectiveCount: mapped.filter((item) => item.active).length };
  });
  return {
    currency: workspace?.currency ?? "ZAR",
    types,
    catalogue: catalogue.map((service) => ({ id: service.id, name: service.name, active: service.active })),
  };
}

async function requireOwnService(db: Executor, scope: WorkspaceScope, serviceId: string) {
  const [service] = await db.select({ id: services.id, name: services.name, active: services.active }).from(services)
    .where(and(tenantWhere(services.workspaceId, scope), eq(services.id, serviceId))).limit(1);
  if (!service) throw new MappingError("That service does not belong to this workspace.");
  return service;
}

export async function addServiceMapping(scope: WorkspaceScope, input: { opportunityType: string; serviceId: string }) {
  requireManager(scope);
  const opportunityType = requireType(input.opportunityType);
  return getDatabase().transaction(async (tx) => {
    const service = await requireOwnService(tx, scope, input.serviceId);
    if (!service.active) throw new MappingError("Activate the service before mapping it.");
    const [created] = await tx.insert(opportunityServiceMappings).values({
      workspaceId: scope.workspaceId,
      opportunityType,
      serviceId: service.id,
      createdByUserId: scope.userId,
    }).onConflictDoNothing().returning({ id: opportunityServiceMappings.id });
    if (created) {
      await tx.insert(auditLogs).values({
        workspaceId: scope.workspaceId,
        actorUserId: scope.userId,
        action: "opportunity_service_mapping.added",
        targetType: "service",
        targetId: service.id,
        metadata: { opportunityType, serviceName: service.name },
      });
    }
    return { changed: Boolean(created) };
  });
}

export async function removeServiceMapping(scope: WorkspaceScope, input: { opportunityType: string; serviceId: string }) {
  requireManager(scope);
  const opportunityType = requireType(input.opportunityType);
  return getDatabase().transaction(async (tx) => {
    const removed = await tx.delete(opportunityServiceMappings).where(and(
      eq(opportunityServiceMappings.workspaceId, scope.workspaceId),
      eq(opportunityServiceMappings.opportunityType, opportunityType),
      eq(opportunityServiceMappings.serviceId, input.serviceId),
    )).returning({ id: opportunityServiceMappings.id });
    if (removed.length > 0) {
      await tx.insert(auditLogs).values({
        workspaceId: scope.workspaceId,
        actorUserId: scope.userId,
        action: "opportunity_service_mapping.removed",
        targetType: "service",
        targetId: input.serviceId,
        metadata: { opportunityType },
      });
    }
    return { changed: removed.length > 0 };
  });
}

/** Sets the single preferred service for a type, or clears it when `serviceId` is null. */
export async function setPreferredService(scope: WorkspaceScope, input: { opportunityType: string; serviceId: string | null }) {
  requireManager(scope);
  const opportunityType = requireType(input.opportunityType);
  return getDatabase().transaction(async (tx) => {
    const scopeToType = and(
      eq(opportunityServiceMappings.workspaceId, scope.workspaceId),
      eq(opportunityServiceMappings.opportunityType, opportunityType),
    );
    if (input.serviceId !== null) {
      const service = await requireOwnService(tx, scope, input.serviceId);
      if (!service.active) throw new MappingError("An inactive service cannot be the preferred service.");
      const [existing] = await tx.select({ id: opportunityServiceMappings.id }).from(opportunityServiceMappings)
        .where(and(scopeToType, eq(opportunityServiceMappings.serviceId, service.id))).limit(1);
      if (!existing) throw new MappingError("Map the service to this opportunity type before making it preferred.");
    }
    await tx.update(opportunityServiceMappings).set({ isPreferred: false, updatedAt: new Date() })
      .where(and(scopeToType, eq(opportunityServiceMappings.isPreferred, true)));
    if (input.serviceId !== null) {
      await tx.update(opportunityServiceMappings).set({ isPreferred: true, updatedAt: new Date() })
        .where(and(scopeToType, eq(opportunityServiceMappings.serviceId, input.serviceId)));
    }
    await tx.insert(auditLogs).values({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "opportunity_service_mapping.preferred_changed",
      targetType: "service",
      targetId: input.serviceId,
      metadata: { opportunityType, cleared: input.serviceId === null },
    });
    return { changed: true };
  });
}
