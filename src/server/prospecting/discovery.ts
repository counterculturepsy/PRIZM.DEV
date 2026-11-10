import { createHash } from "node:crypto";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getServerEnv, type ServerEnv } from "@/config/env";
import { safeParseCompanyRow, type CompanyCsvRow } from "@/modules/prospecting/csv";
import { OSM_INDUSTRY_FILTERS, type IndustryFilters } from "@/modules/prospecting/overpass";
import {
  DiscoveryProviderError,
  type BusinessSearchQuery,
  type BusinessSearchRecord,
  type DiscoveryProvider,
  type ProviderLicense,
} from "@/modules/prospecting/providers";
import { describeRateLimit, evaluateDiscoveryRateLimit } from "@/modules/prospecting/rate-limit";
import type { WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import { auditLogs, discoveryRuns } from "@/server/db/schema";
import { upsertCompanyRow } from "./imports";
import { OsmExtractProvider } from "./osm-extract-provider";
import { OVERPASS_DEFAULT_ENDPOINT, OverpassProvider } from "./overpass-provider";

const MAX_PAGES_PER_RUN = 3;
const MAX_RECORDS_PER_RUN = 200;
const DAY_MS = 86_400_000;
const OPTIONAL_COLUMNS = ["website", "phone", "email", "address", "city", "province", "industry", "source_url"] as const;

export type DiscoveryStatus =
  | Readonly<{ enabled: false; reason: string }>
  | Readonly<{ enabled: true; providerName: string; license: ProviderLicense; industries: readonly string[] }>;

export class DiscoveryUnavailableError extends Error {
  constructor() {
    super("External discovery is not enabled. Import a CSV to add companies.");
    this.name = "DiscoveryUnavailableError";
  }
}

export class DiscoveryRateLimitedError extends Error {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(message);
    this.name = "DiscoveryRateLimitedError";
  }
}

export type DiscoveryDeps = Readonly<{
  provider?: DiscoveryProvider | null;
  now?: () => Date;
}>;

export type DiscoveryOutcome = Readonly<{
  runId: string;
  providerName: string;
  attribution: string;
  found: number;
  created: number;
  alreadyKnown: number;
  skipped: number;
}>;

const discoveryInputSchema = z.object({
  industry: z.string().trim().min(1).max(120),
  city: z.string().trim().max(80).optional(),
  province: z.string().trim().max(80).optional(),
});

/** Builds the provider selected by server-side configuration. Returns null unless an operator enabled one. */
export function createDiscoveryProvider(
  env: ServerEnv = getServerEnv(),
  industryFilters: IndustryFilters = OSM_INDUSTRY_FILTERS,
): DiscoveryProvider | null {
  if (env.DISCOVERY_PROVIDER === "overpass" && env.DISCOVERY_USER_AGENT) {
    return new OverpassProvider({
      endpoint: env.OVERPASS_API_URL ?? OVERPASS_DEFAULT_ENDPOINT,
      userAgent: env.DISCOVERY_USER_AGENT,
      industryFilters,
    });
  }
  if (env.DISCOVERY_PROVIDER === "osm_extract") {
    return new OsmExtractProvider({ industryFilters, ...(env.OSM_EXTRACT_RADIUS_KM ? { radiusKm: env.OSM_EXTRACT_RADIUS_KM } : {}) });
  }
  return null;
}

export function getDiscoveryStatus(
  env: ServerEnv = getServerEnv(),
  industryFilters: IndustryFilters = OSM_INDUSTRY_FILTERS,
): DiscoveryStatus {
  const provider = createDiscoveryProvider(env, industryFilters);
  if (!provider) return { enabled: false, reason: "External discovery is switched off. Import a CSV to add companies." };
  const industries = Object.keys(industryFilters).sort();
  if (industries.length === 0) return { enabled: false, reason: "No industries are configured for discovery yet." };
  return { enabled: true, providerName: provider.displayName, license: provider.license, industries };
}

export function providerSourceKey(providerId: string, externalId: string): string {
  return `${providerId}:external:${createHash("sha256").update(externalId).digest("hex")}`;
}

/**
 * Maps a provider record onto the same validated row shape the CSV importer uses. Optional values that fail
 * validation are dropped and reported, so one malformed phone number cannot discard a real company.
 */
export function toCompanyRow(record: BusinessSearchRecord): { row: CompanyCsvRow; basis: Record<string, string> } | null {
  const candidate: Record<string, string> = { name: record.name.value, country_code: "ZA", external_id: record.externalId };
  const optionalValues: Record<(typeof OPTIONAL_COLUMNS)[number], string | undefined> = {
    website: record.website?.value,
    phone: record.phone?.value,
    email: record.email?.value,
    address: record.address?.value,
    city: record.city?.value,
    province: record.province?.value,
    industry: record.industry?.value,
    source_url: record.sourceUrl,
  };
  for (const column of OPTIONAL_COLUMNS) {
    const value = optionalValues[column];
    if (value) candidate[column] = value;
  }

  const basis: Record<string, string> = {};
  if (record.city?.kind === "inferred") basis["basis_city"] = "search_area";
  if (record.province?.kind === "inferred") basis["basis_province"] = "search_area";

  const dropped: string[] = [];
  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt += 1) {
    const parsed = safeParseCompanyRow(candidate);
    if (parsed.success) {
      if (dropped.length > 0) basis["dropped_invalid_fields"] = dropped.join(",");
      return { row: parsed.data, basis };
    }
    const field = parsed.error.issues[0]?.path[0];
    if (typeof field !== "string" || field === "name" || field === "country_code" || field === "external_id" || !(field in candidate)) return null;
    delete candidate[field];
    dropped.push(field);
  }
  return null;
}

async function markRunFailed(runId: string, workspaceId: string, userId: string, code: string): Promise<void> {
  await getDatabase().transaction(async (tx) => {
    await tx.update(discoveryRuns).set({ status: "failed", errorCode: code, completedAt: new Date() }).where(and(
      eq(discoveryRuns.workspaceId, workspaceId),
      eq(discoveryRuns.id, runId),
    ));
    await tx.insert(auditLogs).values({
      workspaceId, actorUserId: userId, action: "prospecting.discovery_failed", targetType: "discovery_run", targetId: runId, metadata: { code },
    });
  });
}

/** Searches the configured provider and saves the results as workspace companies, with source attribution. */
export async function runCompanyDiscovery(scope: WorkspaceScope, rawInput: unknown, deps: DiscoveryDeps = {}): Promise<DiscoveryOutcome> {
  const provider = deps.provider === undefined ? createDiscoveryProvider() : deps.provider;
  if (!provider) throw new DiscoveryUnavailableError();
  const now = deps.now ?? (() => new Date());

  const parsed = discoveryInputSchema.safeParse(rawInput);
  if (!parsed.success || (!parsed.data.city && !parsed.data.province)) {
    throw new DiscoveryProviderError("invalid_query", "Choose an industry and a city or province.");
  }
  const { industry, city, province } = parsed.data;
  const query: BusinessSearchQuery = {
    countryCode: "ZA",
    industries: [industry],
    ...(city ? { city } : {}),
    ...(province ? { region: province } : {}),
  };

  const db = getDatabase();
  const runId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope.workspaceId}))`);
    const recent = await tx.select({ startedAt: discoveryRuns.startedAt, status: discoveryRuns.status, errorCode: discoveryRuns.errorCode })
      .from(discoveryRuns)
      .where(and(
        eq(discoveryRuns.workspaceId, scope.workspaceId),
        ne(discoveryRuns.provider, "csv"),
        gte(discoveryRuns.startedAt, new Date(now().getTime() - DAY_MS)),
      ));
    const decision = evaluateDiscoveryRateLimit(recent, now(), provider.limits);
    if (!decision.allowed) throw new DiscoveryRateLimitedError(describeRateLimit(decision), decision.retryAfterSeconds);
    const [run] = await tx.insert(discoveryRuns).values({
      workspaceId: scope.workspaceId,
      createdByUserId: scope.userId,
      provider: provider.id,
      filters: { industry, city: city ?? null, province: province ?? null, countryCode: "ZA" },
    }).returning({ id: discoveryRuns.id });
    if (!run) throw new Error("Discovery run was not created");
    return run.id;
  });

  const records: BusinessSearchRecord[] = [];
  let provenance: Readonly<Record<string, string>> = {};
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      const result = await provider.search(cursor ? { ...query, cursor } : query);
      records.push(...result.records);
      provenance = result.provenance ?? provenance;
      cursor = result.cursor;
      if (!cursor || records.length >= MAX_RECORDS_PER_RUN) break;
    }
  } catch (error) {
    const known = error instanceof DiscoveryProviderError
      ? error
      : new DiscoveryProviderError("provider_unavailable", "Discovery failed unexpectedly. Nothing was saved.");
    await markRunFailed(runId, scope.workspaceId, scope.userId, known.code);
    throw known;
  }

  const observedAtValue = new Date(provenance["dataset_data_timestamp"] ?? "");
  const sourceObservedAt = Number.isNaN(observedAtValue.getTime()) ? undefined : observedAtValue;
  try {
    return await db.transaction(async (tx) => {
      let created = 0;
      let alreadyKnown = 0;
      let skipped = 0;
      for (const record of records.slice(0, MAX_RECORDS_PER_RUN)) {
        const mapped = toCompanyRow(record);
        if (!mapped) { skipped += 1; continue; }
        const outcome = await upsertCompanyRow(tx, scope, mapped.row, {
          provider: provider.id,
          kind: "observed",
          confidence: "medium",
          sourceKey: providerSourceKey(provider.id, record.externalId),
          mode: "fill_missing",
          ...(sourceObservedAt ? { observedAt: sourceObservedAt } : {}),
          snapshotExtras: { ...provenance, ...mapped.basis },
        });
        if (outcome === "created") created += 1;
        else alreadyKnown += 1;
      }
      const found = Math.min(records.length, MAX_RECORDS_PER_RUN);
      await tx.update(discoveryRuns).set({ status: "completed", resultCount: found, completedAt: new Date() }).where(and(
        eq(discoveryRuns.workspaceId, scope.workspaceId),
        eq(discoveryRuns.id, runId),
      ));
      await tx.insert(auditLogs).values({
        workspaceId: scope.workspaceId,
        actorUserId: scope.userId,
        action: "prospecting.discovery_run",
        targetType: "discovery_run",
        targetId: runId,
        metadata: { provider: provider.id, found, created, alreadyKnown, skipped },
      });
      return { runId, providerName: provider.displayName, attribution: provider.license.attribution, found, created, alreadyKnown, skipped };
    });
  } catch (error) {
    await markRunFailed(runId, scope.workspaceId, scope.userId, "persist_failed");
    throw error;
  }
}
