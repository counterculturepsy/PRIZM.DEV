import { and, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import {
  EXTRACT_LOADER_VERSION,
  parseExtractLine,
  type Bbox,
  type ExtractRecord,
  type SkipReason,
} from "@/modules/prospecting/osm-extract";
import { OSM_INDUSTRY_FILTERS, type IndustryFilters } from "@/modules/prospecting/overpass";
import { getDatabase } from "@/server/db";
import { osmDatasets, osmLocalities, osmPlaces } from "@/server/db/schema";

const BATCH_SIZE = 500;
const STALE_IMPORT_HOURS = 6;

export type ExtractDatasetMeta = Readonly<{
  regionKey: string;
  regionLabel: string;
  sourceName: string;
  sourceUrl: string;
  sourceDataTimestamp: Date;
  sourceSha256?: string;
  bbox: Bbox;
}>;

export type ScanOptions = Readonly<{ filters?: IndustryFilters; bbox: Bbox }>;
export type ScanResult = Readonly<{
  lines: number;
  places: number;
  localities: number;
  skipped: Readonly<Partial<Record<SkipReason | "duplicate", number>>>;
  industries: Readonly<Record<string, number>>;
}>;
export type LoadResult = ScanResult & Readonly<{ datasetId: string }>;

export class ExtractLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractLoadError";
  }
}

type Counters = {
  lines: number;
  places: number;
  localities: number;
  skipped: Partial<Record<SkipReason | "duplicate", number>>;
  industries: Record<string, number>;
};

const newCounters = (): Counters => ({ lines: 0, places: 0, localities: 0, skipped: {}, industries: {} });

function countSkip(counters: Counters, reason: SkipReason | "duplicate", amount = 1): void {
  counters.skipped[reason] = (counters.skipped[reason] ?? 0) + amount;
}

async function* parseRecords(
  lines: AsyncIterable<string> | Iterable<string>,
  options: ScanOptions,
  counters: Counters,
): AsyncGenerator<ExtractRecord> {
  const filters = options.filters ?? OSM_INDUSTRY_FILTERS;
  const seen = new Set<string>();
  for await (const line of lines) {
    counters.lines += 1;
    const parsed = parseExtractLine(line, { filters, bbox: options.bbox });
    if (!parsed.ok) {
      if (parsed.reason !== "empty") countSkip(counters, parsed.reason);
      continue;
    }
    const identity = `${parsed.record.kind}:${parsed.record.osmType}/${parsed.record.osmId}`;
    if (seen.has(identity)) {
      countSkip(counters, "duplicate");
      continue;
    }
    seen.add(identity);
    if (parsed.record.kind === "place") {
      counters.places += 1;
      const label = parsed.record.industry ?? "Unclassified";
      counters.industries[label] = (counters.industries[label] ?? 0) + 1;
    } else {
      counters.localities += 1;
    }
    yield parsed.record;
  }
}

/** Parses an extract without touching any database. Use it to check a real file before loading it. */
export async function scanExtract(lines: AsyncIterable<string> | Iterable<string>, options: ScanOptions): Promise<ScanResult> {
  const counters = newCounters();
  for await (const record of parseRecords(lines, options, counters)) void record;
  return counters;
}

/**
 * Loads an `osmium export` GeoJSON-sequence extract into the separate `osm_source` schema. The dataset only becomes
 * `ready` (and the previous one `superseded`) after every batch is stored; on any failure its rows are removed.
 */
export async function loadOsmExtract(
  lines: AsyncIterable<string> | Iterable<string>,
  meta: ExtractDatasetMeta,
  options: Readonly<{ filters?: IndustryFilters; expectedLines?: number }> = {},
): Promise<LoadResult> {
  const db = getDatabase();
  const [dataset] = await db.insert(osmDatasets).values({
    regionKey: meta.regionKey,
    regionLabel: meta.regionLabel,
    sourceName: meta.sourceName,
    sourceUrl: meta.sourceUrl,
    sourceDataTimestamp: meta.sourceDataTimestamp,
    sourceSha256: meta.sourceSha256 ?? null,
    bbox: meta.bbox,
    loaderVersion: EXTRACT_LOADER_VERSION,
  }).returning({ id: osmDatasets.id });
  if (!dataset) throw new ExtractLoadError("The dataset record was not created.");

  const counters = newCounters();
  let placeBatch: (typeof osmPlaces.$inferInsert)[] = [];
  let localityBatch: (typeof osmLocalities.$inferInsert)[] = [];
  let storedPlaces = 0;
  let storedLocalities = 0;

  const flush = async () => {
    if (placeBatch.length > 0) {
      const inserted = await db.insert(osmPlaces).values(placeBatch).onConflictDoNothing().returning({ id: osmPlaces.id });
      storedPlaces += inserted.length;
      countSkip(counters, "duplicate", placeBatch.length - inserted.length);
      placeBatch = [];
    }
    if (localityBatch.length > 0) {
      const inserted = await db.insert(osmLocalities).values(localityBatch).onConflictDoNothing().returning({ id: osmLocalities.id });
      storedLocalities += inserted.length;
      countSkip(counters, "duplicate", localityBatch.length - inserted.length);
      localityBatch = [];
    }
  };

  try {
    for await (const record of parseRecords(lines, { ...(options.filters ? { filters: options.filters } : {}), bbox: meta.bbox }, counters)) {
      if (record.kind === "place") {
        placeBatch.push({
          datasetId: dataset.id, osmType: record.osmType, osmId: record.osmId, name: record.name,
          matchedTags: [...record.matchedTags], industry: record.industry, lat: record.lat, lon: record.lon,
          website: record.website, phone: record.phone, email: record.email, address: record.address,
          city: record.city, province: record.province, tags: { ...record.tags },
        });
      } else {
        localityBatch.push({
          datasetId: dataset.id, osmType: record.osmType, osmId: record.osmId, name: record.name,
          placeType: record.placeType, lat: record.lat, lon: record.lon, population: record.population,
        });
      }
      if (placeBatch.length >= BATCH_SIZE || localityBatch.length >= BATCH_SIZE) await flush();
    }
    await flush();
    if (options.expectedLines !== undefined && counters.lines !== options.expectedLines) {
      throw new ExtractLoadError(`Read ${counters.lines} lines but the file has ${options.expectedLines}, so nothing was published.`);
    }
    if (storedPlaces === 0 || storedLocalities === 0) {
      throw new ExtractLoadError("The extract held no usable businesses or no named places, so nothing was published.");
    }

    const skippedTotal = Object.values(counters.skipped).reduce((total, value) => total + (value ?? 0), 0);
    await db.transaction(async (tx) => {
      await tx.update(osmDatasets).set({ status: "superseded" }).where(and(
        eq(osmDatasets.regionKey, meta.regionKey), eq(osmDatasets.status, "ready"), ne(osmDatasets.id, dataset.id),
      ));
      await tx.update(osmDatasets).set({
        status: "ready", placeCount: storedPlaces, localityCount: storedLocalities, skippedCount: skippedTotal, completedAt: new Date(),
      }).where(eq(osmDatasets.id, dataset.id));
    });
  } catch (error) {
    await db.delete(osmPlaces).where(eq(osmPlaces.datasetId, dataset.id));
    await db.delete(osmLocalities).where(eq(osmLocalities.datasetId, dataset.id));
    await db.update(osmDatasets).set({ status: "failed", completedAt: new Date() }).where(eq(osmDatasets.id, dataset.id));
    throw error;
  }
  return { datasetId: dataset.id, ...counters, places: storedPlaces, localities: storedLocalities };
}

/** Deletes failed and superseded datasets, plus imports that never finished. Returns how many datasets were removed. */
export async function purgeInactiveExtractDatasets(): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_IMPORT_HOURS * 3_600_000);
  const removed = await getDatabase().delete(osmDatasets).where(or(
    inArray(osmDatasets.status, ["failed", "superseded"]),
    and(eq(osmDatasets.status, "importing"), lt(osmDatasets.createdAt, staleBefore)),
  )).returning({ id: osmDatasets.id });
  return removed.length;
}

export async function describeExtractDatasets() {
  return getDatabase().select({
    id: osmDatasets.id, regionKey: osmDatasets.regionKey, status: osmDatasets.status, places: osmDatasets.placeCount,
    localities: osmDatasets.localityCount, dataTimestamp: osmDatasets.sourceDataTimestamp, completedAt: osmDatasets.completedAt,
    approxPlaceRows: sql<number>`(select count(*)::int from ${osmPlaces} where ${osmPlaces.datasetId} = ${osmDatasets.id})`,
  }).from(osmDatasets).orderBy(sql`${osmDatasets.createdAt} desc`);
}
