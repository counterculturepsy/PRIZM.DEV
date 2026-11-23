import { getServerEnv, type ServerEnv } from "@/config/env";
import { getCountry } from "@/modules/prospecting/geography";
import { OSM_INDUSTRY_FILTERS, type IndustryFilters } from "@/modules/prospecting/overpass";
import {
  DiscoveryProviderError,
  type BusinessSearchQuery,
  type DiscoveryProvider,
  type ProviderDataKind,
} from "@/modules/prospecting/providers";
import { FixtureProvider } from "./fixture-provider";
import { OsmExtractProvider } from "./osm-extract-provider";
import { OVERPASS_DEFAULT_ENDPOINT, OverpassProvider } from "./overpass-provider";

/** Real sources are tried before live APIs, and synthetic fixtures only answer when nothing real covers the place. */
const DATA_KIND_PRIORITY: Readonly<Record<ProviderDataKind, number>> = { local_dataset: 0, live_api: 1, synthetic_fixture: 2 };

function enabledProviderIds(env: ServerEnv): readonly string[] {
  if (env.DISCOVERY_PROVIDERS) return env.DISCOVERY_PROVIDERS;
  return env.DISCOVERY_PROVIDER === "none" ? [] : [env.DISCOVERY_PROVIDER];
}

/** Builds every provider the operator enabled through server-side configuration. Empty unless one was enabled. */
export function createDiscoveryProviders(env: ServerEnv = getServerEnv(), industryFilters: IndustryFilters = OSM_INDUSTRY_FILTERS): readonly DiscoveryProvider[] {
  const providers: DiscoveryProvider[] = [];
  for (const id of enabledProviderIds(env)) {
    if (id === "overpass" && env.DISCOVERY_USER_AGENT) {
      providers.push(new OverpassProvider({ endpoint: env.OVERPASS_API_URL ?? OVERPASS_DEFAULT_ENDPOINT, userAgent: env.DISCOVERY_USER_AGENT, industryFilters }));
    } else if (id === "osm_extract") {
      providers.push(new OsmExtractProvider({ industryFilters, ...(env.OSM_EXTRACT_RADIUS_KM ? { radiusKm: env.OSM_EXTRACT_RADIUS_KM } : {}) }));
    } else if (id === "fixture") {
      providers.push(new FixtureProvider());
    }
  }
  return providers.toSorted((a, b) => (DATA_KIND_PRIORITY[a.capabilities?.dataKind ?? "live_api"]) - (DATA_KIND_PRIORITY[b.capabilities?.dataKind ?? "live_api"]));
}

export type ProviderSelection = Readonly<{ provider: DiscoveryProvider; basis: string }>;

function placeLabel(query: BusinessSearchQuery): string {
  const country = getCountry(query.countryCode)?.name ?? query.countryCode;
  return query.city ? `${query.city}, ${country}` : country;
}

/**
 * Picks the first provider that can really serve the place. When none can, the error lists why each declined, so the
 * user gets an actionable message and results from an unrelated place are never substituted.
 */
export async function selectProvider(providers: readonly DiscoveryProvider[], query: BusinessSearchQuery): Promise<ProviderSelection> {
  const declined: string[] = [];
  for (const provider of providers) {
    const countries = provider.capabilities?.countries;
    if (countries && countries !== "any" && !countries.includes(query.countryCode)) {
      const names = countries.map((code) => getCountry(code)?.name ?? code).join(", ");
      declined.push(`${provider.displayName} covers ${names} only.`);
      continue;
    }
    try {
      const decision = provider.coverage ? await provider.coverage(query) : { supported: true as const, basis: "Declared coverage" };
      if (decision.supported) return { provider, basis: decision.basis };
      declined.push(decision.reason.endsWith(".") ? decision.reason : `${decision.reason}.`);
    } catch {
      declined.push(`${provider.displayName} could not check its coverage right now.`);
    }
  }
  const detail = declined.length > 0 ? ` ${declined.join(" ")}` : "";
  throw new DiscoveryProviderError("unsupported_location", `No configured data source covers ${placeLabel(query)}.${detail} Ask a workspace administrator to enable a source for this location.`);
}
