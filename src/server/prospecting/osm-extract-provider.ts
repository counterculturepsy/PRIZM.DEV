import { and, asc, between, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeSearchPlace, resolveIndustryTags } from "@/modules/prospecting/osm-extract";
import { resolveCity } from "@/modules/prospecting/geography";
import { OSM_EXTRACT_REGION_COUNTRY, selectCandidateDatasets } from "@/modules/prospecting/osm-datasets";
import { assertKeyword, type IndustryFilters } from "@/modules/prospecting/overpass";
import {
  DiscoveryProviderError,
  type BusinessSearchPage,
  type BusinessSearchQuery,
  type BusinessSearchRecord,
  type CoverageDecision,
  type DiscoveryProvider,
  type ProviderCapabilities,
  type ProviderLicense,
  type SourcedValue,
} from "@/modules/prospecting/providers";
import type { DiscoveryLimits } from "@/modules/prospecting/rate-limit";
import { getDatabase } from "@/server/db";
import { osmDatasets, osmLocalities, osmPlaces } from "@/server/db/schema";

export const OSM_EXTRACT_PROVIDER_ID = "osm_extract";
export const DEFAULT_RADIUS_KM = 10;
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 50;
const DEFAULT_PAGE_SIZE = 100;
const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEGREE = 111.32;

/** A local database read has no external quota, so runs are limited far less than calls to a public API. */
export const OSM_EXTRACT_LIMITS: DiscoveryLimits = {
  minIntervalSeconds: 2,
  maxPerHour: 60,
  maxPerDay: 300,
  inProgressSeconds: 300,
  providerCooldownSeconds: 30,
};

export { OSM_EXTRACT_REGION_COUNTRY };

type DatasetRow = typeof osmDatasets.$inferSelect;

/** Coverage of a single dataset. Kept for callers that reason about one extract; the provider itself uses the multi-dataset selection. */
export function datasetCoverage(dataset: Pick<DatasetRow, "regionKey" | "regionLabel" | "bbox"> & { id?: string }, query: BusinessSearchQuery): CoverageDecision {
  const selection = selectCandidateDatasets([{ id: dataset.id ?? "single", regionKey: dataset.regionKey, regionLabel: dataset.regionLabel, bbox: dataset.bbox }], query);
  return selection.supported ? { supported: true, basis: selection.basis } : selection;
}

/** The cursor also names the dataset it was issued for, so a page marker can never be replayed against different data. */
const cursorSchema = z.object({ d: z.number().finite().min(0), i: z.number().int().positive(), ds: z.uuid().optional() });

function encodeCursor(distanceKm: number, id: number, datasetId: string): string {
  return Buffer.from(JSON.stringify({ d: distanceKm, i: id, ds: datasetId })).toString("base64url");
}

function decodeCursor(cursor: string): { d: number; i: number; ds?: string | undefined } {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through to the shared error below.
  }
  throw new DiscoveryProviderError("invalid_query", "The page marker is not valid. Start the search again.");
}

export type OsmExtractProviderOptions = Readonly<{
  industryFilters: IndustryFilters;
  radiusKm?: number;
  pageSize?: number;
}>;

/**
 * Searches the locally loaded OpenStreetMap extract (see the `osm_source` schema). It makes no network requests.
 * Places are found within a radius of a named place in the same extract, so results are approximate by distance, not
 * by administrative boundary.
 */
export class OsmExtractProvider implements DiscoveryProvider {
  readonly id = OSM_EXTRACT_PROVIDER_ID;
  readonly displayName = "OpenStreetMap extract (local)";
  readonly license: ProviderLicense = {
    name: "Open Database License (ODbL) 1.0",
    url: "https://www.openstreetmap.org/copyright",
    attribution: "© OpenStreetMap contributors",
  };
  readonly limits = OSM_EXTRACT_LIMITS;
  readonly capabilities: ProviderCapabilities = {
    countries: ["ZA"], region: false, city: true, industry: true, keyword: true, pagination: "cursor", dataKind: "local_dataset",
  };

  constructor(private readonly options: OsmExtractProviderOptions) {}

  /** The newest ready dataset of every region. Several regions can be ready at once; a new load only replaces its own region. */
  private async loadDatasets(): Promise<DatasetRow[]> {
    return getDatabase().selectDistinctOn([osmDatasets.regionKey]).from(osmDatasets).where(eq(osmDatasets.status, "ready"))
      .orderBy(osmDatasets.regionKey, desc(osmDatasets.completedAt), asc(osmDatasets.id));
  }

  async coverage(query: BusinessSearchQuery): Promise<CoverageDecision> {
    const selection = selectCandidateDatasets(await this.loadDatasets(), query);
    return selection.supported ? { supported: true, basis: selection.basis } : selection;
  }

  async search(query: BusinessSearchQuery): Promise<BusinessSearchPage> {
    const tags = resolveIndustryTags(query.industries, this.options.industryFilters);
    if (!query.city) throw new DiscoveryProviderError("invalid_query", "Choose a city or town that is in the loaded extract.");
    const city = resolveCity(query.countryCode, normalizeSearchPlace(query.city));
    const keyword = query.keyword ? assertKeyword(query.keyword) : undefined;
    const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, query.radiusKm ?? this.options.radiusKm ?? DEFAULT_RADIUS_KM));
    const pageSize = this.options.pageSize ?? DEFAULT_PAGE_SIZE;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const db = getDatabase();

    const datasets = await this.loadDatasets();
    if (datasets.length === 0) throw new DiscoveryProviderError("provider_unavailable", "No local OpenStreetMap extract is loaded yet.");
    const selection = selectCandidateDatasets(datasets, query);
    if (!selection.supported) throw new DiscoveryProviderError("unsupported_location", selection.reason);

    // Find the named place in the covering datasets, then search only the dataset it belongs to. One dataset per search
    // keeps paging and provenance single-sourced, and a business present in two overlapping datasets is never listed twice.
    const rank = new Map(selection.candidates.map((candidate, index) => [candidate.id, index] as const));
    const localityNames = sql.join(city.osmNames.map((name) => sql`${name.toLowerCase()}`), sql`, `);
    const found = await db.select().from(osmLocalities).where(and(
      inArray(osmLocalities.datasetId, selection.candidates.map((candidate) => candidate.id)),
      sql`lower(${osmLocalities.name}) in (${localityNames})`,
    )).orderBy(
      sql`case ${osmLocalities.placeType} when 'city' then 0 when 'town' then 1 when 'suburb' then 2 when 'village' then 3 else 4 end`,
      sql`${osmLocalities.population} desc nulls last`,
      asc(osmLocalities.id),
    ).limit(50);
    const placeRank: Readonly<Record<string, number>> = { city: 0, town: 1, suburb: 2, village: 3, hamlet: 4 };
    const locality = found.toSorted((a, b) => (placeRank[a.placeType] ?? 4) - (placeRank[b.placeType] ?? 4)
      || (b.population ?? -1) - (a.population ?? -1)
      || (rank.get(a.datasetId) ?? 0) - (rank.get(b.datasetId) ?? 0)
      || a.id - b.id)[0];
    if (!locality) {
      const labels = [...new Set(selection.candidates.map((candidate) => candidate.regionLabel))].sort().join(" and ");
      throw new DiscoveryProviderError("invalid_query", `"${city.name}" is not in the loaded ${labels} ${selection.candidates.length === 1 ? "extract" : "extracts"}. Check the spelling or try a nearby town.`);
    }
    const dataset = datasets.find((candidate) => candidate.id === locality.datasetId);
    if (!dataset) throw new DiscoveryProviderError("provider_unavailable", "The dataset for this place is no longer available. Search again.");
    if (cursor?.ds && cursor.ds !== dataset.id) {
      throw new DiscoveryProviderError("invalid_query", "The page marker belongs to different data (the extract was reloaded). Start the search again.");
    }

    const centerLat = sql`${locality.lat}::double precision`;
    const centerLon = sql`${locality.lon}::double precision`;
    const distanceKm = sql<number>`(${sql.raw(String(EARTH_RADIUS_KM))} * 2 * asin(least(1.0, sqrt(
      power(sin(radians(${osmPlaces.lat} - ${centerLat}) / 2), 2)
      + cos(radians(${centerLat})) * cos(radians(${osmPlaces.lat})) * power(sin(radians(${osmPlaces.lon} - ${centerLon}) / 2), 2)
    ))))`;
    const latDelta = radiusKm / KM_PER_DEGREE;
    const lonDelta = radiusKm / (KM_PER_DEGREE * Math.max(0.1, Math.cos((locality.lat * Math.PI) / 180)));
    const tagList = sql.join(tags.map((tag) => sql`${tag}`), sql`, `);

    const rows = await db.select({ place: osmPlaces, distance: distanceKm }).from(osmPlaces).where(and(
      eq(osmPlaces.datasetId, dataset.id),
      sql`${osmPlaces.matchedTags} && ARRAY[${tagList}]::text[]`,
      between(osmPlaces.lat, locality.lat - latDelta, locality.lat + latDelta),
      between(osmPlaces.lon, locality.lon - lonDelta, locality.lon + lonDelta),
      sql`${distanceKm} <= ${radiusKm}::double precision`,
      keyword ? sql`${osmPlaces.name} ilike ${`%${keyword}%`}` : undefined,
      cursor ? sql`(${distanceKm}, ${osmPlaces.id}) > (${cursor.d}::double precision, ${cursor.i}::bigint)` : undefined,
    )).orderBy(distanceKm, asc(osmPlaces.id)).limit(pageSize + 1);

    const page = rows.slice(0, pageSize);
    const last = page[page.length - 1];
    const observedAt = dataset.sourceDataTimestamp.toISOString();
    const fact = (value: string, kind: SourcedValue<string>["kind"] = "observed", source = "openstreetmap"): SourcedValue<string> => ({
      value, kind, confidence: "medium", source, observedAt,
    });

    const records = page.map(({ place }): BusinessSearchRecord => ({
      externalId: `${place.osmType}/${place.osmId}`,
      name: fact(place.name),
      ...(place.website ? { website: fact(place.website) } : {}),
      ...(place.phone ? { phone: fact(place.phone) } : {}),
      ...(place.email ? { email: fact(place.email) } : {}),
      ...(place.address ? { address: fact(place.address) } : {}),
      city: place.city ? fact(place.city) : fact(locality.name, "inferred", "openstreetmap:search-area"),
      ...(place.province ? { province: fact(place.province) } : {}),
      ...(place.industry ? { industry: fact(place.industry) } : {}),
      sourceUrl: `https://www.openstreetmap.org/${place.osmType}/${place.osmId}`,
    }));

    return {
      records,
      ...(rows.length > pageSize && last ? { cursor: encodeCursor(last.distance, last.place.id, dataset.id) } : {}),
      provenance: {
        dataset_id: dataset.id,
        dataset_region: dataset.regionKey,
        dataset_data_timestamp: observedAt,
        dataset_loaded_at: (dataset.completedAt ?? dataset.createdAt).toISOString(),
        dataset_loader_version: dataset.loaderVersion,
        search_locality: locality.name,
        search_radius_km: String(radiusKm),
      },
    };
  }
}
