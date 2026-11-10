import { and, asc, between, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeSearchPlace, resolveIndustryTags } from "@/modules/prospecting/osm-extract";
import type { IndustryFilters } from "@/modules/prospecting/overpass";
import {
  DiscoveryProviderError,
  type BusinessSearchPage,
  type BusinessSearchQuery,
  type BusinessSearchRecord,
  type DiscoveryProvider,
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

const cursorSchema = z.object({ d: z.number().finite().min(0), i: z.number().int().positive() });

function encodeCursor(distanceKm: number, id: number): string {
  return Buffer.from(JSON.stringify({ d: distanceKm, i: id })).toString("base64url");
}

function decodeCursor(cursor: string): { d: number; i: number } {
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

  constructor(private readonly options: OsmExtractProviderOptions) {}

  async search(query: BusinessSearchQuery): Promise<BusinessSearchPage> {
    const tags = resolveIndustryTags(query.industries, this.options.industryFilters);
    if (!query.city) throw new DiscoveryProviderError("invalid_query", "Choose a city or town that is in the loaded extract.");
    const city = normalizeSearchPlace(query.city);
    const radiusKm = Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, query.radiusKm ?? this.options.radiusKm ?? DEFAULT_RADIUS_KM));
    const pageSize = this.options.pageSize ?? DEFAULT_PAGE_SIZE;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const db = getDatabase();

    const [dataset] = await db.select().from(osmDatasets).where(eq(osmDatasets.status, "ready"))
      .orderBy(desc(osmDatasets.completedAt)).limit(1);
    if (!dataset) throw new DiscoveryProviderError("provider_unavailable", "No local OpenStreetMap extract is loaded yet.");

    const [locality] = await db.select().from(osmLocalities).where(and(
      eq(osmLocalities.datasetId, dataset.id),
      sql`lower(${osmLocalities.name}) = lower(${city})`,
    )).orderBy(
      sql`case ${osmLocalities.placeType} when 'city' then 0 when 'town' then 1 when 'suburb' then 2 when 'village' then 3 else 4 end`,
      sql`${osmLocalities.population} desc nulls last`,
      asc(osmLocalities.id),
    ).limit(1);
    if (!locality) {
      throw new DiscoveryProviderError("invalid_query", `"${city}" is not in the loaded ${dataset.regionLabel} extract. Check the spelling or try a nearby town.`);
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
      ...(rows.length > pageSize && last ? { cursor: encodeCursor(last.distance, last.place.id) } : {}),
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
