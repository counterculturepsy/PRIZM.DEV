import { and, eq } from "drizzle-orm";
import type { WorkspaceScope } from "@/modules/workspaces/scope";
import { companyDedupeKey, companySourceKey, normalizeDomain, parseCompanyCsv, type CompanyCsvRow } from "@/modules/prospecting/csv";
import { getDatabase } from "@/server/db";
import { auditLogs, companies, companySources, discoveryRuns } from "@/server/db/schema";

export type ImportResult = Readonly<{ rows: number; created: number; updated: number }>;

type Database = ReturnType<typeof getDatabase>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CompanySourceInput = Readonly<{
  provider: string;
  kind: "observed" | "user_supplied" | "inferred";
  confidence: "high" | "medium" | "low";
  sourceKey: string;
  /**
   * `overwrite` replaces stored fields with the supplied values (user-supplied CSV).
   * `fill_missing` only completes fields that are still empty, so external data never replaces what a user entered.
   */
  mode: "overwrite" | "fill_missing";
  /** When the source itself observed the data (for example an OSM extract's data date). Defaults to the import time. */
  observedAt?: Date;
  /** Extra provenance stored with the source snapshot, for example which fields came from the search area. */
  snapshotExtras?: Readonly<Record<string, string>>;
}>;

function definedCompanyValues(row: CompanyCsvRow): Partial<typeof companies.$inferInsert> {
  const candidate = {
    description: row.description,
    industry: row.industry,
    employeeEstimate: row.employee_estimate,
    address: row.address,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    website: row.website,
    domain: normalizeDomain(row.website),
    phone: row.phone,
    email: row.email,
    whatsapp: row.whatsapp,
    facebookUrl: row.facebook_url,
    instagramUrl: row.instagram_url,
    linkedinUrl: row.linkedin_url,
    googleMapsUrl: row.google_maps_url,
    ratingHundredths: row.rating === undefined ? undefined : Math.round(row.rating * 100),
    reviewCount: row.review_count,
  };
  return Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined));
}

/** Creates or updates one workspace company, matched by domain or normalized identity, and records its source. */
export async function upsertCompanyRow(
  tx: DatabaseTransaction,
  scope: WorkspaceScope,
  row: CompanyCsvRow,
  source: CompanySourceInput,
): Promise<"created" | "updated"> {
  const dedupeKey = companyDedupeKey(row);
  const [existing] = await tx.select().from(companies).where(and(
    eq(companies.workspaceId, scope.workspaceId),
    eq(companies.dedupeKey, dedupeKey),
  )).limit(1);
  const values = definedCompanyValues(row);

  let companyId: string;
  let outcome: "created" | "updated";
  if (existing) {
    const updates: Partial<typeof companies.$inferInsert> = source.mode === "overwrite"
      ? { name: row.name, ...values }
      : Object.fromEntries(Object.entries(values).filter(([key]) => existing[key as keyof typeof existing] === null));
    if (source.mode === "overwrite" || Object.keys(updates).length > 0) {
      await tx.update(companies).set({ ...updates, updatedAt: new Date() }).where(and(
        eq(companies.workspaceId, scope.workspaceId),
        eq(companies.id, existing.id),
      ));
    }
    companyId = existing.id;
    outcome = "updated";
  } else {
    const [company] = await tx.insert(companies).values({
      workspaceId: scope.workspaceId,
      dedupeKey,
      name: row.name,
      ...values,
      countryCode: row.country_code ?? "ZA",
    }).returning({ id: companies.id });
    if (!company) throw new Error("Company was not created");
    companyId = company.id;
    outcome = "created";
  }

  const snapshot = {
    ...Object.fromEntries(Object.entries(row).filter((entry): entry is [string, string | number] => entry[1] !== undefined)),
    ...source.snapshotExtras,
  };
  await tx.insert(companySources).values({
    workspaceId: scope.workspaceId,
    companyId,
    provider: source.provider,
    sourceKey: source.sourceKey,
    externalId: row.external_id ?? null,
    sourceUrl: row.source_url ?? null,
    confidence: source.confidence,
    kind: source.kind,
    observedAt: source.observedAt ?? new Date(),
    snapshot,
  }).onConflictDoNothing({ target: [companySources.workspaceId, companySources.sourceKey] });
  return outcome;
}

export async function importCompanyCsv(scope: WorkspaceScope, input: string): Promise<ImportResult> {
  const rows = parseCompanyCsv(input);
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [run] = await tx.insert(discoveryRuns).values({
      workspaceId: scope.workspaceId,
      createdByUserId: scope.userId,
      provider: "csv",
      filters: { rows: rows.length },
    }).returning({ id: discoveryRuns.id });
    if (!run) throw new Error("Discovery run was not created");

    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const outcome = await upsertCompanyRow(tx, scope, row, {
        provider: "csv",
        kind: "user_supplied",
        confidence: "medium",
        sourceKey: companySourceKey(row),
        mode: "overwrite",
      });
      if (outcome === "created") created += 1;
      else updated += 1;
    }

    await tx.update(discoveryRuns).set({ status: "completed", resultCount: rows.length, completedAt: new Date() }).where(and(
      eq(discoveryRuns.workspaceId, scope.workspaceId),
      eq(discoveryRuns.id, run.id),
    ));
    await tx.insert(auditLogs).values({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "prospecting.csv_imported",
      targetType: "discovery_run",
      targetId: run.id,
      metadata: { rows: rows.length, created, updated },
    });
    return { rows: rows.length, created, updated };
  });
}
