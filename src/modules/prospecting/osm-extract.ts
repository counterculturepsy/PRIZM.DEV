import { z } from "zod";
import { DiscoveryProviderError } from "./providers";
import { assertPlaceName, type IndustryFilters } from "./overpass";

export const EXTRACT_LOADER_VERSION = "osm-extract-v1";
export const MAX_FEATURE_LINE_BYTES = 1_000_000;
const MAX_NAME_LENGTH = 160;
const MAX_TAG_VALUE_LENGTH = 500;
const MAX_INDUSTRIES_PER_QUERY = 5;

export type Bbox = Readonly<{ minLon: number; minLat: number; maxLon: number; maxLat: number }>;

/**
 * Approximate rectangle around the Western Cape, used only to bound what the loader keeps. It also covers slivers of
 * neighbouring provinces, so records are never labelled with a province unless OpenStreetMap tags one.
 */
export const WESTERN_CAPE_BBOX: Bbox = { minLon: 17.5, minLat: -35.0, maxLon: 24.6, maxLat: -30.2 };

export const LOCALITY_TYPES = ["city", "town", "suburb", "village", "hamlet"] as const;
export type LocalityType = (typeof LOCALITY_TYPES)[number];
export type OsmType = "node" | "way" | "relation";

const ALLOWED_TAG_KEYS = new Set([
  "name", "name:en", "name:af", "brand", "operator", "website", "contact:website", "url", "phone", "contact:phone",
  "email", "contact:email", "addr:housenumber", "addr:street", "addr:suburb", "addr:city", "addr:postcode",
  "addr:province", "addr:state", "opening_hours", "amenity", "shop", "office", "tourism", "healthcare", "leisure",
]);

export type ExtractRecord =
  | Readonly<{
    kind: "place";
    osmType: OsmType;
    osmId: number;
    name: string;
    matchedTags: readonly string[];
    industry: string | null;
    lat: number;
    lon: number;
    website: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
    tags: Readonly<Record<string, string>>;
  }>
  | Readonly<{
    kind: "locality";
    osmType: OsmType;
    osmId: number;
    name: string;
    placeType: LocalityType;
    lat: number;
    lon: number;
    population: number | null;
  }>;

export type SkipReason =
  | "empty" | "line_too_long" | "invalid_json" | "invalid_feature" | "missing_id" | "missing_name"
  | "name_too_long" | "no_match" | "invalid_geometry" | "outside_bbox";

export type ParsedLine = Readonly<{ ok: true; record: ExtractRecord }> | Readonly<{ ok: false; reason: SkipReason }>;

const position = z.array(z.number()).min(2);
const featureSchema = z.object({
  type: z.literal("Feature"),
  id: z.union([z.string(), z.number()]).optional(),
  geometry: z.discriminatedUnion("type", [
    z.object({ type: z.literal("Point"), coordinates: position }),
    z.object({ type: z.literal("LineString"), coordinates: z.array(position).min(2) }),
    z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(position)).min(1) }),
    z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(z.array(position))).min(1) }),
  ]),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
});
type Geometry = z.infer<typeof featureSchema>["geometry"];

/**
 * Decodes an `osmium export --add-unique-id=type_id` id: `n123`, `w123`, `r123`, or an area id `a246`
 * (a way's id doubled, or a relation's id doubled plus one).
 */
export function decodeOsmId(id: unknown): { osmType: OsmType; osmId: number } | null {
  if (typeof id !== "string") return null;
  const match = /^([nwra])(\d{1,15})$/.exec(id);
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  switch (match[1]) {
    case "n": return { osmType: "node", osmId: value };
    case "w": return { osmType: "way", osmId: value };
    case "r": return { osmType: "relation", osmId: value };
    default: {
      const original = Math.floor(value / 2);
      return original > 0 ? { osmType: value % 2 === 0 ? "way" : "relation", osmId: original } : null;
    }
  }
}

function ringArea(ring: readonly (readonly number[])[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1 = 0, y1 = 0] = ring[index] ?? [];
    const [x2 = 0, y2 = 0] = ring[index + 1] ?? [];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function ringCentroid(ring: readonly (readonly number[])[]): { lon: number; lat: number } | null {
  const area = ringArea(ring);
  if (Math.abs(area) > 1e-12) {
    let cx = 0;
    let cy = 0;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const [x1 = 0, y1 = 0] = ring[index] ?? [];
      const [x2 = 0, y2 = 0] = ring[index + 1] ?? [];
      const cross = x1 * y2 - x2 * y1;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    return { lon: cx / (6 * area), lat: cy / (6 * area) };
  }
  return meanPoint(ring);
}

function meanPoint(points: readonly (readonly number[])[]): { lon: number; lat: number } | null {
  if (points.length === 0) return null;
  const lon = points.reduce((total, point) => total + (point[0] ?? 0), 0) / points.length;
  const lat = points.reduce((total, point) => total + (point[1] ?? 0), 0) / points.length;
  return { lon, lat };
}

/** A single representative point for any supported geometry; polygons use the centroid of their largest outer ring. */
export function representativePoint(geometry: Geometry): { lon: number; lat: number } | null {
  let point: { lon: number; lat: number } | null;
  switch (geometry.type) {
    case "Point":
      point = { lon: geometry.coordinates[0] ?? Number.NaN, lat: geometry.coordinates[1] ?? Number.NaN };
      break;
    case "LineString":
      point = meanPoint(geometry.coordinates);
      break;
    case "Polygon":
      point = ringCentroid(geometry.coordinates[0] ?? []);
      break;
    default: {
      const largest = [...geometry.coordinates]
        .map((polygon) => polygon[0] ?? [])
        .sort((left, right) => Math.abs(ringArea(right)) - Math.abs(ringArea(left)))[0];
      point = ringCentroid(largest ?? []);
    }
  }
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  if (point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) return null;
  return point;
}

export function isInsideBbox(point: { lon: number; lat: number }, bbox: Bbox): boolean {
  return point.lon >= bbox.minLon && point.lon <= bbox.maxLon && point.lat >= bbox.minLat && point.lat <= bbox.maxLat;
}

function cleanText(value: unknown, maxLength = MAX_TAG_VALUE_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function clause(value: string): { key: string; value: string } | null {
  const separator = value.indexOf("=");
  return separator > 0 ? { key: value.slice(0, separator), value: value.slice(separator + 1) } : null;
}

/** Parses one line of an `osmium export -f geojsonseq` file into a place, a locality, or a skip reason. */
export function parseExtractLine(line: string, options: Readonly<{ filters: IndustryFilters; bbox: Bbox }>): ParsedLine {
  const text = line.replace(/\u001e/g, "").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (Buffer.byteLength(text, "utf8") > MAX_FEATURE_LINE_BYTES) return { ok: false, reason: "line_too_long" };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const parsed = featureSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "invalid_feature" };
  const feature = parsed.data;

  const identity = decodeOsmId(feature.id);
  if (!identity) return { ok: false, reason: "missing_id" };
  const rawTags = feature.properties ?? {};
  const tag = (key: string) => cleanText(rawTags[key]);

  const name = cleanText(rawTags["name"], 10_000);
  if (!name) return { ok: false, reason: "missing_name" };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: "name_too_long" };

  const point = representativePoint(feature.geometry);
  if (!point) return { ok: false, reason: "invalid_geometry" };
  if (!isInsideBbox(point, options.bbox)) return { ok: false, reason: "outside_bbox" };

  const placeType = LOCALITY_TYPES.find((type) => type === tag("place"));
  if (placeType) {
    const population = /^\d{1,9}$/.test(tag("population") ?? "") ? Number(tag("population")) : null;
    return { ok: true, record: { kind: "locality", ...identity, name, placeType, lat: point.lat, lon: point.lon, population } };
  }

  const matchedTags: string[] = [];
  let industry: string | null = null;
  for (const [label, clauses] of Object.entries(options.filters)) {
    for (const candidate of clauses) {
      const parts = clause(candidate);
      if (parts && tag(parts.key) === parts.value) {
        matchedTags.push(candidate);
        industry ??= label;
      }
    }
  }
  if (matchedTags.length === 0) return { ok: false, reason: "no_match" };

  const tags: Record<string, string> = {};
  for (const key of ALLOWED_TAG_KEYS) {
    const value = tag(key);
    if (value) tags[key] = value;
  }
  const street = tag("addr:street");
  const address = street ? [tag("addr:housenumber"), street].filter(Boolean).join(" ") : null;

  return {
    ok: true,
    record: {
      kind: "place",
      ...identity,
      name,
      matchedTags: [...new Set(matchedTags)],
      industry,
      lat: point.lat,
      lon: point.lon,
      website: tag("website") ?? tag("contact:website") ?? tag("url"),
      phone: tag("phone") ?? tag("contact:phone"),
      email: tag("email") ?? tag("contact:email"),
      address,
      city: tag("addr:city"),
      province: tag("addr:province") ?? tag("addr:state"),
      tags,
    },
  };
}

/** The `osmium tags-filter` expressions that keep exactly what this loader can use. One expression per tag key. */
export function buildTagsFilterExpressions(filters: IndustryFilters): string[] {
  const valuesByKey = new Map<string, Set<string>>();
  for (const clauses of Object.values(filters)) {
    for (const candidate of clauses) {
      const parts = clause(candidate);
      if (!parts) throw new Error(`Invalid industry tag: ${candidate}`);
      valuesByKey.set(parts.key, (valuesByKey.get(parts.key) ?? new Set()).add(parts.value));
    }
  }
  return [
    ...[...valuesByKey].map(([key, values]) => `nwr/${key}=${[...values].join(",")}`),
    `n/place=${LOCALITY_TYPES.join(",")}`,
  ];
}

/** Resolves industry labels to their tag clauses, rejecting unknown labels. */
export function resolveIndustryTags(industries: readonly string[], filters: IndustryFilters): string[] {
  if (industries.length === 0 || industries.length > MAX_INDUSTRIES_PER_QUERY) {
    throw new DiscoveryProviderError("invalid_query", `Choose between 1 and ${MAX_INDUSTRIES_PER_QUERY} industries.`);
  }
  return [...new Set(industries.flatMap((industry) => {
    const tags = Object.hasOwn(filters, industry) ? filters[industry] : undefined;
    if (!tags || tags.length === 0) throw new DiscoveryProviderError("invalid_query", `Industry is not available for discovery: ${industry}.`);
    return tags;
  }))];
}

export function normalizeSearchPlace(value: string): string {
  return assertPlaceName(value, "City");
}
