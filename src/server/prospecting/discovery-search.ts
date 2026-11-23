import { and, eq, inArray } from "drizzle-orm";
import { getServerEnv } from "@/config/env";
import { companyDedupeKey, normalizeDomain } from "@/modules/prospecting/csv";
import { getCountry } from "@/modules/prospecting/geography";
import { DiscoveryProviderError, type ProviderDataKind } from "@/modules/prospecting/providers";
import { hasCapability, type WorkspaceScope } from "@/modules/workspaces/scope";
import { getDatabase } from "@/server/db";
import { auditLogs, companies, discoveryRuns } from "@/server/db/schema";
import { signCandidate, verifyCandidate } from "./candidate-token";
import {
  DiscoveryUnavailableError,
  discoveryProvidersFor,
  markRunFailed,
  parseDiscoveryInput,
  providerSourceKey,
  reserveDiscoveryRun,
  runFilters,
  toCompanyRow,
  toSearchQuery,
  type DiscoveryDeps,
  type ParsedDiscoveryInput,
} from "./discovery";
import { upsertCompanyRow } from "./imports";
import { selectProvider } from "./provider-router";

export type DiscoverySearchDeps = DiscoveryDeps & Readonly<{ secret?: string }>;

export type DiscoveryCandidate = Readonly<{
  /** Signed, workspace-bound reference used to save this result. It is not an authorisation by itself. */
  token: string;
  externalId: string;
  name: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  countryCode: string;
  sourceUrl: string | null;
  /** Set when this business is already a company in this workspace. */
  existingCompanyId: string | null;
}>;

export type DiscoveryPreview = Readonly<{
  providerId: string;
  providerName: string;
  dataKind: ProviderDataKind | null;
  attribution: string;
  licenseName: string;
  licenseUrl: string;
  coverageBasis: string;
  query: ParsedDiscoveryInput;
  candidates: readonly DiscoveryCandidate[];
  /** Present when the provider has more results for the same search. */
  nextCursor: string | null;
  /** Filters the chosen provider cannot apply. They were ignored, and the UI must say so. */
  ignoredFilters: readonly string[];
  skipped: number;
}>;

const toNullable = (value: string | undefined): string | null => value ?? null;

/**
 * Searches the provider that covers the place and returns normalised, de-duplicated candidates without saving any.
 * The search still counts against the workspace's rate limit and is recorded as a run, so previews cannot bypass quotas.
 */
export async function previewCompanyDiscovery(
  scope: WorkspaceScope,
  rawInput: unknown,
  cursor: string | undefined,
  deps: DiscoverySearchDeps = {},
): Promise<DiscoveryPreview> {
  if (!hasCapability(scope, "write")) throw new DiscoveryProviderError("invalid_query", "You do not have permission to search for companies in this workspace.");
  const providers = discoveryProvidersFor(deps);
  if (providers.length === 0) throw new DiscoveryUnavailableError();
  const now = deps.now ?? (() => new Date());

  const input = parseDiscoveryInput(rawInput);
  const query = toSearchQuery(input);
  const { provider, basis } = await selectProvider(providers, query);
  const capabilities = provider.capabilities;
  if (input.keyword && capabilities && !capabilities.keyword) {
    throw new DiscoveryProviderError("invalid_query", `${provider.displayName} cannot filter by keyword. Clear the keyword to search.`);
  }
  const ignoredFilters = input.province && capabilities && !capabilities.region
    ? [`${getCountry(input.countryCode)?.regionLabel ?? "Region"} is not supported by ${provider.displayName} and was ignored.`]
    : [];

  const runId = await reserveDiscoveryRun(scope, provider, { ...runFilters(input), preview: true }, now);
  let page;
  try {
    page = await provider.search(cursor ? { ...query, cursor } : query);
  } catch (error) {
    const known = error instanceof DiscoveryProviderError
      ? error
      : new DiscoveryProviderError("provider_unavailable", "The search failed unexpectedly. Nothing was saved.");
    await markRunFailed(runId, scope.workspaceId, scope.userId, known.code);
    throw known;
  }

  const mapped = page.records.flatMap((record) => {
    const result = toCompanyRow(record, input.countryCode);
    return result ? [{ record, row: result.row }] : [];
  });
  const secret = deps.secret ?? getServerEnv().AUTH_SECRET;
  const db = getDatabase();
  const keys = mapped.map(({ row }) => companyDedupeKey(row));
  const existing = keys.length === 0 ? [] : await db.select({ id: companies.id, dedupeKey: companies.dedupeKey }).from(companies).where(and(
    eq(companies.workspaceId, scope.workspaceId),
    inArray(companies.dedupeKey, keys),
  ));
  const existingByKey = new Map(existing.map((company) => [company.dedupeKey, company.id]));
  const provenance = page.provenance ?? {};

  const candidates = mapped.map(({ record, row }): DiscoveryCandidate => ({
    token: signCandidate(secret, scope.workspaceId, { provider: provider.id, country: input.countryCode, record, provenance }, now()),
    externalId: record.externalId,
    name: row.name,
    website: toNullable(row.website),
    domain: normalizeDomain(row.website) ?? null,
    phone: toNullable(row.phone),
    email: toNullable(row.email),
    address: toNullable(row.address),
    city: toNullable(row.city),
    region: toNullable(row.province),
    industry: toNullable(row.industry),
    countryCode: input.countryCode,
    sourceUrl: toNullable(row.source_url),
    existingCompanyId: existingByKey.get(companyDedupeKey(row)) ?? null,
  }));

  await db.transaction(async (tx) => {
    await tx.update(discoveryRuns).set({ status: "completed", resultCount: candidates.length, completedAt: new Date() }).where(and(
      eq(discoveryRuns.workspaceId, scope.workspaceId),
      eq(discoveryRuns.id, runId),
    ));
    await tx.insert(auditLogs).values({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "prospecting.discovery_preview",
      targetType: "discovery_run",
      targetId: runId,
      metadata: { provider: provider.id, found: candidates.length, skipped: page.records.length - candidates.length },
    });
  });

  return {
    providerId: provider.id,
    providerName: provider.displayName,
    dataKind: capabilities?.dataKind ?? null,
    attribution: provider.license.attribution,
    licenseName: provider.license.name,
    licenseUrl: provider.license.url,
    coverageBasis: basis,
    query: input,
    candidates,
    nextCursor: page.cursor ?? null,
    ignoredFilters,
    skipped: page.records.length - candidates.length,
  };
}

export type SavedCandidate = Readonly<{ companyId: string; name: string; created: boolean }>;

/**
 * Saves one previewed result as a workspace company. Only a token this server signed for this workspace is accepted,
 * so the browser cannot inject arbitrary company data. Existing user-entered fields are never overwritten.
 */
export async function saveDiscoveredCandidate(scope: WorkspaceScope, token: string, deps: DiscoverySearchDeps = {}): Promise<SavedCandidate> {
  if (!hasCapability(scope, "write")) throw new DiscoveryProviderError("invalid_query", "You do not have permission to save companies in this workspace.");
  const now = (deps.now ?? (() => new Date()))();
  const payload = verifyCandidate(deps.secret ?? getServerEnv().AUTH_SECRET, scope.workspaceId, token, now);
  if (!payload) throw new DiscoveryProviderError("invalid_query", "This search result has expired or is not valid. Search again to save it.");
  const mapped = toCompanyRow(payload.record, payload.country);
  if (!mapped) throw new DiscoveryProviderError("invalid_query", "This result does not have enough valid data to save.");

  const observedAt = new Date(payload.provenance["dataset_data_timestamp"] ?? "");
  return getDatabase().transaction(async (tx) => {
    const outcome = await upsertCompanyRow(tx, scope, mapped.row, {
      provider: payload.provider,
      kind: "observed",
      confidence: "medium",
      sourceKey: providerSourceKey(payload.provider, payload.record.externalId),
      mode: "fill_missing",
      ...(Number.isNaN(observedAt.getTime()) ? {} : { observedAt }),
      snapshotExtras: { ...payload.provenance, ...mapped.basis },
    });
    const [company] = await tx.select({ id: companies.id }).from(companies).where(and(
      eq(companies.workspaceId, scope.workspaceId),
      eq(companies.dedupeKey, companyDedupeKey(mapped.row)),
    )).limit(1);
    if (!company) throw new Error("Saved company could not be found");
    await tx.insert(auditLogs).values({
      workspaceId: scope.workspaceId,
      actorUserId: scope.userId,
      action: "prospecting.discovery_company_saved",
      targetType: "company",
      targetId: company.id,
      metadata: { provider: payload.provider, created: outcome === "created" },
    });
    return { companyId: company.id, name: mapped.row.name, created: outcome === "created" };
  });
}
