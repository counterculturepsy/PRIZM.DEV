import { createHash } from "node:crypto";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getServerEnv, type ServerEnv } from "@/config/env";
import { safeParseCompanyRow, type CompanyCsvRow } from "@/modules/prospecting/csv";
import { resolveCity, resolveCountry } from "@/modules/prospecting/geography";
import { OSM_INDUSTRY_FILTERS, type IndustryFilters } from "@/modules/prospecting/overpass";
import {
  DiscoveryProviderError,
  type BusinessSearchQuery,
  type BusinessSearchRecord,
  type DiscoveryProvider,
  type ProviderCapabilities,
  type ProviderLicense,
} from "@/modules/prospecting/providers";
import { describeRateLimit, evaluateDiscoveryRateLimit } from "@/modules/prospecting/rate-limit";
import type { WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import { auditLogs, discoveryRuns } from "@/server/db/schema";
import { upsertCompanyRow } from "./imports";
import { createDiscoveryProviders, selectProvider } from "./provider-router";

const MAX_PAGES_PER_RUN = 3;
const MAX_RECORDS_PER_RUN = 200;
const DAY_MS = 86_400_000;
const OPTIONAL_COLUMNS = ["website", "phone", "email", "address", "city", "province", "industry", "source_url"] as const;

export type ProviderSummary = Readonly<{
  id: string;
  name: string;
  license: ProviderLicense;
  capabilities: ProviderCapabilities | null;
}>;

export type DiscoveryStatus =
  | Readonly<{ enabled: false; reason: string }>
  | Readonly<{ enabled: true; providerName: string; license: ProviderLicense; industries: readonly string[]; providers: readonly ProviderSummary[] }>;

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
  /** One explicit provider (tests, scripts). `null` means discovery is switched off. */
  provider?: DiscoveryProvider | null;
  /** Several providers to route between. Defaults to the providers enabled by server configuration. */
  providers?: readonly DiscoveryProvider[];
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
  /** ISO code or country name. Omitted means South Africa, which keeps the original single-country callers working. */
  countryCode: z.string().trim().min(2).max(40).optional(),
  industry: z.string().trim().min(1).max(120),
  city: z.string().trim().max(80).optional(),
  province: z.string().trim().max(80).optional(),
  keyword: z.string().trim().max(80).optional(),
});

export type ParsedDiscoveryInput = Readonly<{
  countryCode: string;
  industry: string;
  city?: string;
  province?: string;
  keyword?: string;
}>;

/** Validates a search and resolves country and city aliases, so every provider receives canonical values. */
export function parseDiscoveryInput(rawInput: unknown): ParsedDiscoveryInput {
  const parsed = discoveryInputSchema.safeParse(rawInput);
  if (!parsed.success || (!parsed.data.city && !parsed.data.province)) {
    throw new DiscoveryProviderError("invalid_query", "Choose an industry and a city or province.");
  }
  const country = resolveCountry(parsed.data.countryCode ?? "ZA");
  if (!country) throw new DiscoveryProviderError("invalid_query", "Choose a supported country.");
  const { industry, province, keyword } = parsed.data;
  const city = parsed.data.city ? resolveCity(country.code, parsed.data.city).name : undefined;
  return {
    countryCode: country.code,
    industry,
    ...(city ? { city } : {}),
    ...(province ? { province } : {}),
    ...(keyword ? { keyword } : {}),
  };
}

export function toSearchQuery(input: ParsedDiscoveryInput): BusinessSearchQuery {
  return {
    countryCode: input.countryCode,
    industries: [input.industry],
    ...(input.city ? { city: input.city } : {}),
    ...(input.province ? { region: input.province } : {}),
    ...(input.keyword ? { keyword: input.keyword } : {}),
  };
}

/** The providers a call may use: the injected one, or those enabled by server configuration. */
export function discoveryProvidersFor(deps: DiscoveryDeps): readonly DiscoveryProvider[] {
  if (deps.provider !== undefined) return deps.provider ? [deps.provider] : [];
  return deps.providers ?? createDiscoveryProviders();
}

/** Builds the first provider selected by server-side configuration. Returns null unless an operator enabled one. */
export function createDiscoveryProvider(
  env: ServerEnv = getServerEnv(),
  industryFilters: IndustryFilters = OSM_INDUSTRY_FILTERS,
): DiscoveryProvider | null {
  return createDiscoveryProviders(env, industryFilters)[0] ?? null;
}

export function getDiscoveryStatus(
  env: ServerEnv = getServerEnv(),
  industryFilters: IndustryFilters = OSM_INDUSTRY_FILTERS,
): DiscoveryStatus {
  const providers = createDiscoveryProviders(env, industryFilters);
  const [first] = providers;
  if (!first) return { enabled: false, reason: "External discovery is switched off. Import a CSV to add companies." };
  const industries = Object.keys(industryFilters).sort();
  if (industries.length === 0) return { enabled: false, reason: "No industries are configured for discovery yet." };
  return {
    enabled: true,
    providerName: providers.map((provider) => provider.displayName).join(" + "),
    license: first.license,
    industries,
    providers: providers.map((provider) => ({ id: provider.id, name: provider.displayName, license: provider.license, capabilities: provider.capabilities ?? null })),
  };
}

export function providerSourceKey(providerId: string, externalId: string): string {
  return `${providerId}:external:${createHash("sha256").update(externalId).digest("hex")}`;
}

/**
 * Maps a provider record onto the same validated row shape the CSV importer uses. Optional values that fail
 * validation are dropped and reported, so one malformed phone number cannot discard a real company.
 */
export function toCompanyRow(record: BusinessSearchRecord, countryCode = "ZA"): { row: CompanyCsvRow; basis: Record<string, string> } | null {
  const candidate: Record<string, string> = { name: record.name.value, country_code: countryCode, external_id: record.externalId };
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

export async function markRunFailed(runId: string, workspaceId: string, userId: string, code: string): Promise<void> {
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

type RunFilters = Record<string, string | number | boolean | null>;

export function runFilters(input: ParsedDiscoveryInput): RunFilters {
  return {
    industry: input.industry,
    city: input.city ?? null,
    province: input.province ?? null,
    countryCode: input.countryCode,
    ...(input.keyword ? { keyword: input.keyword } : {}),
  };
}

/** Applies the per-workspace rate limit and records the run, atomically. Throws `DiscoveryRateLimitedError` when over the limit. */
export async function reserveDiscoveryRun(
  scope: WorkspaceScope,
  provider: DiscoveryProvider,
  filters: RunFilters,
  now: () => Date,
): Promise<string> {
  return getDatabase().transaction(async (tx) => {
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
      filters,
    }).returning({ id: discoveryRuns.id });
    if (!run) throw new Error("Discovery run was not created");
    return run.id;
  });
}

/** Searches the matching provider and saves the results as workspace companies, with source attribution. */
export async function runCompanyDiscovery(scope: WorkspaceScope, rawInput: unknown, deps: DiscoveryDeps = {}): Promise<DiscoveryOutcome> {
  const providers = discoveryProvidersFor(deps);
  if (providers.length === 0) throw new DiscoveryUnavailableError();
  const now = deps.now ?? (() => new Date());

  const input = parseDiscoveryInput(rawInput);
  const query = toSearchQuery(input);
  const { provider } = await selectProvider(providers, query);
  const runId = await reserveDiscoveryRun(scope, provider, runFilters(input), now);

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
  const db = getDatabase();
  try {
    return await db.transaction(async (tx) => {
      let created = 0;
      let alreadyKnown = 0;
      let skipped = 0;
      for (const record of records.slice(0, MAX_RECORDS_PER_RUN)) {
        const mapped = toCompanyRow(record, input.countryCode);
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
