// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildTagsFilterExpressions, decodeOsmId, MAX_FEATURE_LINE_BYTES, parseExtractLine, representativePoint,
  resolveIndustryTags, WESTERN_CAPE_BBOX,
} from "./osm-extract";
import { OSM_INDUSTRY_FILTERS } from "./overpass";

const filters = { Dentists: ["amenity=dentist"], Gyms: ["leisure=fitness_centre", "amenity=gym"] } as const;
const options = { filters, bbox: WESTERN_CAPE_BBOX };
const point = (lon: number, lat: number) => ({ type: "Point", coordinates: [lon, lat] });
const line = (id: unknown, properties: Record<string, unknown>, geometry: unknown = point(18.86, -33.93), separator = "") =>
  `${separator}${JSON.stringify({ type: "Feature", ...(id === undefined ? {} : { id }), geometry, properties })}`;

function skipReason(text: string) {
  const result = parseExtractLine(text, options);
  if (result.ok) throw new Error("Expected the line to be skipped");
  return result.reason;
}

describe("OSM ids", () => {
  it("decodes node, way, relation and area ids", () => {
    expect(decodeOsmId("n123")).toEqual({ osmType: "node", osmId: 123 });
    expect(decodeOsmId("w45")).toEqual({ osmType: "way", osmId: 45 });
    expect(decodeOsmId("r7")).toEqual({ osmType: "relation", osmId: 7 });
    expect(decodeOsmId("a246")).toEqual({ osmType: "way", osmId: 123 });
    expect(decodeOsmId("a247")).toEqual({ osmType: "relation", osmId: 123 });
  });

  it("rejects ids that cannot identify a stored object", () => {
    for (const bad of ["x1", "n0", "n-5", "n", "", "a1", 123, null, undefined, "n99999999999999999999"]) {
      expect(decodeOsmId(bad)).toBeNull();
    }
  });
});

describe("representative points", () => {
  const square = { type: "Polygon" as const, coordinates: [[[18, -34], [18.2, -34], [18.2, -33.8], [18, -33.8], [18, -34]]] };

  it("uses the point itself, the polygon centroid, and the largest part of a multipolygon", () => {
    expect(representativePoint({ type: "Point", coordinates: [18.5, -33.9] })).toEqual({ lon: 18.5, lat: -33.9 });
    const centre = representativePoint(square);
    expect(centre?.lon).toBeCloseTo(18.1, 6);
    expect(centre?.lat).toBeCloseTo(-33.9, 6);
    const small = [[[19, -34], [19.01, -34], [19.01, -33.99], [19, -33.99], [19, -34]]];
    const multi = representativePoint({ type: "MultiPolygon", coordinates: [small, square.coordinates] });
    expect(multi?.lon).toBeCloseTo(18.1, 6);
  });

  it("falls back for flat shapes and rejects impossible coordinates", () => {
    const flat = representativePoint({ type: "Polygon", coordinates: [[[18, -34], [18.2, -34], [18.1, -34], [18, -34]]] });
    expect(flat?.lat).toBeCloseTo(-34, 6);
    expect(representativePoint({ type: "Point", coordinates: [18, 95] })).toBeNull();
    expect(representativePoint({ type: "Point", coordinates: [200, -34] })).toBeNull();
    expect(representativePoint({ type: "LineString", coordinates: [[18, -34], [18.2, -34.2]] })?.lon).toBeCloseTo(18.1, 6);
  });
});

describe("extract line parsing", () => {
  it("builds a place from matching tags, strips the record separator, and keeps only allowlisted tags", () => {
    const result = parseExtractLine(line("n10", {
      name: "Fixture Dental", amenity: "dentist", "leisure": "fitness_centre", "contact:website": "fixture.example",
      "contact:phone": "+27 21 555 0100", "addr:housenumber": "12", "addr:street": "Fixture Road", "addr:city": "Stellenbosch",
      note: "private note that must not be stored", fixme: "also dropped",
    }, point(18.86, -33.93), "\u001e"), options);
    expect(result.ok).toBe(true);
    if (!result.ok || result.record.kind !== "place") throw new Error("Expected a place");
    expect(result.record).toMatchObject({
      osmType: "node", osmId: 10, name: "Fixture Dental", industry: "Dentists", website: "fixture.example",
      phone: "+27 21 555 0100", address: "12 Fixture Road", city: "Stellenbosch", email: null, province: null,
    });
    expect(result.record.matchedTags).toEqual(["amenity=dentist", "leisure=fitness_centre"]);
    expect(Object.keys(result.record.tags).sort()).toEqual(["addr:city", "addr:housenumber", "addr:street", "amenity", "contact:phone", "contact:website", "leisure", "name"]);
  });

  it("cleans control characters and collapses whitespace in tag values", () => {
    const result = parseExtractLine(line("w5", { name: "Fixture\u0007  Dental\n Clinic", amenity: "dentist" }), options);
    expect(result.ok && result.record.name).toBe("Fixture Dental Clinic");
  });

  it("classifies named places as localities with a validated population", () => {
    const town = parseExtractLine(line("n1", { name: "Stellenbosch", place: "town", population: "77000" }), options);
    expect(town.ok && town.record).toMatchObject({ kind: "locality", placeType: "town", population: 77000 });
    const odd = parseExtractLine(line("n2", { name: "Fixtureville", place: "village", population: "about 200" }), options);
    expect(odd.ok && odd.record).toMatchObject({ kind: "locality", population: null });
    expect(skipReason(line("n3", { name: "Fixture Farm", place: "farm" }))).toBe("no_match");
  });

  it("reports why a line was skipped", () => {
    expect(skipReason("   ")).toBe("empty");
    expect(skipReason("{not json")).toBe("invalid_json");
    expect(skipReason(JSON.stringify({ type: "Feature" }))).toBe("invalid_feature");
    expect(skipReason(line(undefined, { name: "X", amenity: "dentist" }))).toBe("missing_id");
    expect(skipReason(line("n1", { amenity: "dentist" }))).toBe("missing_name");
    expect(skipReason(line("n1", { name: "x".repeat(161), amenity: "dentist" }))).toBe("name_too_long");
    expect(skipReason(line("n1", { name: "Fixture Bakery", shop: "bakery" }))).toBe("no_match");
    expect(skipReason(line("n1", { name: "Fixture Joburg Dental", amenity: "dentist" }, point(28.05, -26.2)))).toBe("outside_bbox");
    expect(skipReason(line("n1", { name: "Fixture Dental", amenity: "dentist" }, point(18.5, 95)))).toBe("invalid_geometry");
    expect(skipReason(line("n1", { name: "Fixture Dental", amenity: "dentist", pad: "x".repeat(MAX_FEATURE_LINE_BYTES) }))).toBe("line_too_long");
  });
});

describe("osmium expressions and industry resolution", () => {
  it("groups the configured tags by key, plus localities", () => {
    const expressions = buildTagsFilterExpressions(OSM_INDUSTRY_FILTERS);
    expect(expressions).toContain("nwr/tourism=hotel,guest_house,hostel");
    expect(expressions).toContain("nwr/office=estate_agent,lawyer,accountant,construction_company,engineer,travel_agent");
    expect(expressions[expressions.length - 1]).toBe("n/place=city,town,suburb,village,hamlet");
    for (const expression of expressions) expect(expression).toMatch(/^(nwr|n)\/[a-z_:]+=[a-z0-9_,]+$/);
  });

  it("resolves known industries and rejects unknown or excessive ones", () => {
    expect(resolveIndustryTags(["Gyms"], filters)).toEqual(["leisure=fitness_centre", "amenity=gym"]);
    for (const bad of [["Plumbers"], ["constructor"], ["__proto__"], []]) {
      expect(() => resolveIndustryTags(bad, filters)).toThrow();
    }
    expect(() => resolveIndustryTags(["Dentists", "Gyms", "Dentists", "Gyms", "Dentists", "Gyms"], filters)).toThrow();
  });
});
