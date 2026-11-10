import { describe, expect, it } from "vitest";
import { buildOverpassQuery, industryFromTags, OSM_INDUSTRY_FILTERS, parseOverpassResponse } from "./overpass";
import { DiscoveryProviderError } from "./providers";

const filters = { Dentists: ["amenity=dentist"], Gyms: ["leisure=fitness_centre", "amenity=gym"] } as const;
const base = { countryCode: "ZA", city: "Cape Town", industries: ["Dentists"] } as const;

function invalidQuery(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DiscoveryProviderError);
    return (error as DiscoveryProviderError).code;
  }
  throw new Error("Expected the query to be rejected");
}

describe("Overpass query building", () => {
  it("scopes a named-business search to the country and place", () => {
    const query = buildOverpassQuery(base, filters);
    expect(query).toContain('area["ISO3166-1"="ZA"]->.country;');
    expect(query).toContain('area["boundary"="administrative"]["name"="Cape Town"]->.place;');
    expect(query).toContain('nwr(area.country)(area.place)["amenity"="dentist"]["name"];');
    expect(query).toContain("out center tags 100;");
  });

  it("adds a province area and one statement per tag filter", () => {
    const query = buildOverpassQuery({ countryCode: "ZA", region: "Western Cape", city: "Stellenbosch", industries: ["Gyms"] }, filters);
    expect(query).toContain('["admin_level"="4"]["name"="Western Cape"]->.region;');
    expect(query).toContain('nwr(area.country)(area.region)(area.place)["leisure"="fitness_centre"]["name"];');
    expect(query).toContain('nwr(area.country)(area.region)(area.place)["amenity"="gym"]["name"];');
  });

  it("accepts real place names with spaces, apostrophes, accents and full stops", () => {
    for (const city of ["Port St. Johns", "King William's Town", "Gqeberha", "Mbombela", "Pietermaritzburg"]) {
      expect(() => buildOverpassQuery({ ...base, city }, filters)).not.toThrow();
    }
  });

  it("rejects input that could change the query structure", () => {
    for (const city of ['Cape Town"];out;//', "Cape\nTown", "Cape Town\\", "a", "Paarl; node(1)", "x".repeat(120)]) {
      expect(invalidQuery(() => buildOverpassQuery({ ...base, city }, filters))).toBe("invalid_query");
    }
    expect(invalidQuery(() => buildOverpassQuery({ countryCode: "ZA", industries: ["Dentists"] }, filters))).toBe("invalid_query");
    expect(invalidQuery(() => buildOverpassQuery({ ...base, countryCode: "za" }, filters))).toBe("invalid_query");
  });

  it("rejects unknown industries, including inherited object keys", () => {
    for (const industry of ["Plumbers", "constructor", "__proto__", "toString"]) {
      expect(invalidQuery(() => buildOverpassQuery({ ...base, industries: [industry] }, filters))).toBe("invalid_query");
    }
    expect(invalidQuery(() => buildOverpassQuery({ ...base, industries: [] }, filters))).toBe("invalid_query");
  });

  it("rejects a misconfigured tag filter", () => {
    expect(invalidQuery(() => buildOverpassQuery({ ...base, industries: ["Bad"] }, { Bad: ['amenity="x"]'] }))).toBe("invalid_query");
  });
});

describe("configured industries", () => {
  const entries = Object.entries(OSM_INDUSTRY_FILTERS);

  it("offers the ten prospecting industries", () => {
    expect(entries.map(([label]) => label)).toEqual([
      "Hotels & Accommodation", "Restaurants & Cafés", "Real Estate Agencies", "Medical & Dental Practices", "Automotive Businesses",
      "Beauty & Wellness", "Retail & E-Commerce Prospects", "Legal & Accounting Services", "Construction & Engineering", "Travel & Tourism Agencies",
    ]);
    expect(entries.flatMap(([, tags]) => tags)).toHaveLength(24);
  });

  it("builds a valid query for every industry and never assigns one tag to two industries", () => {
    const tags = entries.flatMap(([, list]) => list);
    expect(new Set(tags).size).toBe(tags.length);
    for (const [industry] of entries) {
      expect(() => buildOverpassQuery({ countryCode: "ZA", city: "Cape Town", industries: [industry] }, OSM_INDUSTRY_FILTERS)).not.toThrow();
    }
  });

  it("classifies tagged businesses into their industry and leaves unknown tags unclassified", () => {
    expect(industryFromTags({ healthcare: "clinic" }, OSM_INDUSTRY_FILTERS)).toBe("Medical & Dental Practices");
    expect(industryFromTags({ office: "travel_agent" }, OSM_INDUSTRY_FILTERS)).toBe("Travel & Tourism Agencies");
    expect(industryFromTags({ leisure: "fitness_centre" }, OSM_INDUSTRY_FILTERS)).toBe("Beauty & Wellness");
    expect(industryFromTags({ shop: "bakery" }, OSM_INDUSTRY_FILTERS)).toBeUndefined();
  });
});

describe("Overpass response parsing", () => {
  const observedAt = "2026-10-26T10:00:00.000Z";

  it("maps observed tags to sourced values and never invents missing fields", () => {
    const { records, skipped } = parseOverpassResponse({
      elements: [{
        type: "node", id: 101,
        tags: { name: "Fixture Dental Clinic", amenity: "dentist", website: "fixture-dental.example", "contact:phone": "+27 21 555 0100", "addr:housenumber": "12", "addr:street": "Fixture Road", "addr:city": "Cape Town" },
      }, {
        type: "way", id: 202, tags: { name: "Fixture Gym", leisure: "fitness_centre" },
      }],
    }, { query: { ...base, region: "Western Cape" }, filters, observedAt });

    expect(skipped).toBe(0);
    expect(records[0]).toMatchObject({
      externalId: "node/101",
      name: { value: "Fixture Dental Clinic", kind: "observed", source: "openstreetmap", observedAt },
      website: { value: "fixture-dental.example" },
      phone: { value: "+27 21 555 0100" },
      address: { value: "12 Fixture Road" },
      city: { value: "Cape Town", kind: "observed" },
      industry: { value: "Dentists" },
      sourceUrl: "https://www.openstreetmap.org/node/101",
    });
    expect(records[0]?.email).toBeUndefined();
    expect(records[1]).toMatchObject({
      city: { value: "Cape Town", kind: "inferred", source: "openstreetmap:search-area" },
      province: { value: "Western Cape", kind: "inferred" },
      industry: { value: "Gyms" },
    });
    expect(records[1]?.website).toBeUndefined();
    expect(records[1]?.phone).toBeUndefined();
  });

  it("skips elements without a name and duplicate elements", () => {
    const { records, skipped } = parseOverpassResponse({
      elements: [
        { type: "node", id: 1, tags: { amenity: "dentist" } },
        { type: "node", id: 2, tags: { name: "  " } },
        { type: "node", id: 3, tags: { name: "Fixture One" } },
        { type: "node", id: 3, tags: { name: "Fixture One" } },
      ],
    }, { query: base, filters, observedAt });
    expect(records).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it("leaves the industry empty when no configured filter matches", () => {
    expect(industryFromTags({ shop: "bakery" }, filters)).toBeUndefined();
    expect(industryFromTags({ amenity: "dentist" }, filters)).toBe("Dentists");
  });

  it("rejects responses with an unexpected shape", () => {
    expect(() => parseOverpassResponse({ elements: [{ type: "point", id: "x" }] }, { query: base, filters, observedAt })).toThrow(DiscoveryProviderError);
    expect(() => parseOverpassResponse("nope", { query: base, filters, observedAt })).toThrow(DiscoveryProviderError);
  });
});
