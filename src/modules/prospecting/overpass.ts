import { z } from "zod";
import { DiscoveryProviderError, type BusinessSearchQuery, type BusinessSearchRecord, type SourcedValue } from "./providers";

export const OSM_MAX_RESULTS = 100;
const MAX_INDUSTRIES_PER_QUERY = 5;
const PLACE_NAME = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .'’-]{0,78}[\p{L}\p{M}0-9.]$/u;
const TAG_FILTER = /^([a-z_:]{1,40})=([a-z0-9_]{1,60})$/;

/** Industry label shown in PRIZM.DEV mapped to the OpenStreetMap `key=value` tags that identify it. */
export type IndustryFilters = Readonly<Record<string, readonly string[]>>;

/**
 * The industries offered for discovery. Tags inside one industry are alternatives (a business matches any of them).
 * Each tag was checked against the OpenStreetMap wiki and taginfo on 2026-10-26: documented, in wide use, not deprecated.
 * Tags: https://wiki.openstreetmap.org/wiki/Map_features
 */
export const OSM_INDUSTRY_FILTERS: IndustryFilters = {
  "Hotels & Accommodation": ["tourism=hotel", "tourism=guest_house", "tourism=hostel"],
  "Restaurants & Cafés": ["amenity=restaurant", "amenity=cafe"],
  "Real Estate Agencies": ["office=estate_agent"],
  "Medical & Dental Practices": ["amenity=doctors", "amenity=dentist", "healthcare=clinic"],
  "Automotive Businesses": ["shop=car_repair", "shop=car", "shop=tyres"],
  "Beauty & Wellness": ["shop=beauty", "shop=hairdresser", "leisure=fitness_centre"],
  "Retail & E-Commerce Prospects": ["shop=clothes", "shop=electronics", "shop=furniture"],
  "Legal & Accounting Services": ["office=lawyer", "office=accountant"],
  "Construction & Engineering": ["office=construction_company", "office=engineer"],
  "Travel & Tourism Agencies": ["shop=travel_agency", "office=travel_agent"],
};

export function assertPlaceName(value: string, field: string): string {
  const trimmed = value.trim();
  if (!PLACE_NAME.test(trimmed)) {
    throw new DiscoveryProviderError("invalid_query", `${field} may only contain letters, numbers, spaces, hyphens, apostrophes and full stops.`);
  }
  return trimmed;
}

function tagFilterClause(filter: string): string {
  const match = TAG_FILTER.exec(filter);
  if (!match) throw new DiscoveryProviderError("invalid_query", "An industry filter is misconfigured.");
  return `["${match[1]}"="${match[2]}"]`;
}

/**
 * Builds an Overpass QL query for named businesses inside a South African place or province.
 * Every interpolated value is validated against a strict allowlist, so no caller input can alter the query structure.
 */
export function buildOverpassQuery(query: BusinessSearchQuery, filters: IndustryFilters): string {
  if (!/^[A-Z]{2}$/.test(query.countryCode)) throw new DiscoveryProviderError("invalid_query", "Country code must be two capital letters.");
  const city = query.city ? assertPlaceName(query.city, "City") : undefined;
  const region = query.region ? assertPlaceName(query.region, "Province") : undefined;
  if (!city && !region) throw new DiscoveryProviderError("invalid_query", "Choose a city or a province to search.");
  if (query.industries.length === 0 || query.industries.length > MAX_INDUSTRIES_PER_QUERY) {
    throw new DiscoveryProviderError("invalid_query", `Choose between 1 and ${MAX_INDUSTRIES_PER_QUERY} industries.`);
  }

  const tagClauses = query.industries.flatMap((industry) => {
    const tags = Object.hasOwn(filters, industry) ? filters[industry] : undefined;
    if (!tags || tags.length === 0) throw new DiscoveryProviderError("invalid_query", `Industry is not available for discovery: ${industry}.`);
    return tags.map(tagFilterClause);
  });

  const areas = [`area["ISO3166-1"="${query.countryCode}"]->.country;`];
  const areaRefs = ["(area.country)"];
  if (region) {
    areas.push(`area["boundary"="administrative"]["admin_level"="4"]["name"="${region}"]->.region;`);
    areaRefs.push("(area.region)");
  }
  if (city) {
    areas.push(`area["boundary"="administrative"]["name"="${city}"]->.place;`);
    areaRefs.push("(area.place)");
  }

  const statements = tagClauses.map((clause) => `  nwr${areaRefs.join("")}${clause}["name"];`);
  return [`[out:json][timeout:25];`, ...areas, "(", ...statements, ");", `out center tags ${OSM_MAX_RESULTS};`].join("\n");
}

/** Returns the PRIZM.DEV industry label whose tag filters match, or undefined. Never guesses. */
export function industryFromTags(tags: Readonly<Record<string, string>>, filters: IndustryFilters): string | undefined {
  for (const [label, clauses] of Object.entries(filters)) {
    if (clauses.some((clause) => {
      const match = TAG_FILTER.exec(clause);
      return match ? tags[match[1] ?? ""] === match[2] : false;
    })) return label;
  }
  return undefined;
}

const responseSchema = z.object({
  elements: z.array(z.object({
    type: z.enum(["node", "way", "relation"]),
    id: z.number().int(),
    tags: z.record(z.string(), z.string()).optional(),
  })),
});

export type ParsedOverpass = Readonly<{ records: readonly BusinessSearchRecord[]; skipped: number }>;

export function parseOverpassResponse(
  json: unknown,
  context: Readonly<{ query: BusinessSearchQuery; filters: IndustryFilters; observedAt: string }>,
): ParsedOverpass {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new DiscoveryProviderError("provider_bad_response", "The data provider returned an unexpected response.");

  const fact = (value: string): SourcedValue<string> => ({
    value, kind: "observed", confidence: "medium", source: "openstreetmap", observedAt: context.observedAt,
  });
  const searchAreaFact = (value: string): SourcedValue<string> => ({
    value, kind: "inferred", confidence: "medium", source: "openstreetmap:search-area", observedAt: context.observedAt,
  });
  const clean = (value: string | undefined) => value?.trim() || undefined;

  const seen = new Set<string>();
  const records: BusinessSearchRecord[] = [];
  let skipped = 0;
  for (const element of parsed.data.elements) {
    const externalId = `${element.type}/${element.id}`;
    const tags = element.tags ?? {};
    const name = clean(tags["name"]);
    if (!name || seen.has(externalId)) { skipped += 1; continue; }
    seen.add(externalId);

    const website = clean(tags["website"] ?? tags["contact:website"]);
    const phone = clean(tags["phone"] ?? tags["contact:phone"]);
    const email = clean(tags["email"] ?? tags["contact:email"]);
    const street = clean(tags["addr:street"]);
    const address = street ? [clean(tags["addr:housenumber"]), street].filter(Boolean).join(" ") : undefined;
    const city = clean(tags["addr:city"]);
    const province = clean(tags["addr:province"] ?? tags["addr:state"]);
    const industry = industryFromTags(tags, context.filters);

    records.push({
      externalId,
      name: fact(name),
      ...(website ? { website: fact(website) } : {}),
      ...(phone ? { phone: fact(phone) } : {}),
      ...(email ? { email: fact(email) } : {}),
      ...(address ? { address: fact(address) } : {}),
      ...(city ? { city: fact(city) } : context.query.city ? { city: searchAreaFact(context.query.city) } : {}),
      ...(province ? { province: fact(province) } : context.query.region ? { province: searchAreaFact(context.query.region) } : {}),
      ...(industry ? { industry: fact(industry) } : {}),
      sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    });
  }
  return { records, skipped };
}
