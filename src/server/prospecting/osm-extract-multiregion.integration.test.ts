// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import { WESTERN_CAPE_BBOX } from "@/modules/prospecting/osm-extract";
import { OSM_INDUSTRY_FILTERS } from "@/modules/prospecting/overpass";
import { osmDatasets } from "@/server/db/schema";

const GAUTENG_BBOX = { minLon: 27.0, minLat: -27.0, maxLon: 29.1, maxLat: -25.0 };
const point = (lon: number, lat: number) => ({ type: "Point", coordinates: [lon, lat] });
const feature = (id: string, properties: Record<string, string>, lon: number, lat: number) =>
  `\u001e${JSON.stringify({ type: "Feature", id, geometry: point(lon, lat), properties })}`;
const realty = (id: string, name: string, lon: number, lat: number) => feature(id, { name, office: "estate_agent", website: `${id}.example.test` }, lon, lat);

const WESTERN_CAPE_LINES = [
  feature("n9004", { name: "Cape Town", place: "city", population: "4000000" }, 18.4241, -33.9249),
  realty("n401", "Fixture Realty Cape Town", 18.4241, -33.9249),
];
const GAUTENG_LINES = [
  feature("n9101", { name: "Johannesburg", place: "city", population: "5600000" }, 28.0473, -26.2041),
  feature("n9102", { name: "Pretoria", place: "city", population: "2900000" }, 28.1881, -25.7461),
  feature("n9103", { name: "Sandton", place: "suburb" }, 28.0567, -26.1076),
  feature("n9104", { name: "Midrand", place: "suburb" }, 28.1283, -25.9992),
  realty("n501", "Fixture Realty Johannesburg A", 28.0473, -26.2041),
  realty("n502", "Fixture Realty Johannesburg B", 28.0573, -26.2041),
  realty("n503", "Fixture Realty Johannesburg C", 28.0673, -26.2041),
  realty("n504", "Fixture Realty Johannesburg D", 28.0773, -26.2041),
  realty("n505", "Fixture Realty Sandton", 28.0567, -26.1076),
  realty("n506", "Fixture Realty Pretoria", 28.1881, -25.7461),
  realty("n507", "Fixture Realty Midrand", 28.1283, -25.9992),
  feature("n508", { name: "Fixture Law Johannesburg", office: "lawyer" }, 28.0473, -26.2041),
];
const VIETNAM_BBOX = { minLon: 102.1, minLat: 8.3, maxLon: 109.6, maxLat: 23.5 };
const VIETNAM_LINES = [
  // The Hanoi locality is deliberately stored decomposed, as some OpenStreetMap names are.
  feature("n9201", { name: "Hà Nội", place: "city", population: "8000000" }, 105.8542, 21.0285),
  feature("n9202", { name: "Thành phố Hồ Chí Minh", place: "city", population: "9000000" }, 106.6297, 10.8231),
  feature("n601", { name: "Công Ty Phần Mềm Mẫu", office: "it", website: "n601.example.test" }, 105.85, 21.03),
  feature("n602", { name: "Nhà Hàng Mẫu", amenity: "restaurant" }, 106.63, 10.82),
  // Three places called "Hạ Long", as in the real data: one in Ha Long itself, one about 40 km east, one ~1,000 km south.
  feature("n9203", { name: "Hạ Long", place: "suburb" }, 107.1073, 20.9454),
  feature("n9204", { name: "Hạ Long", place: "suburb" }, 107.4393, 21.0825),
  feature("n9205", { name: "Hạ Long", place: "village" }, 108.5963, 12.7718),
  feature("n603", { name: "Quán Hạ Long Gần", amenity: "restaurant" }, 107.1073, 20.9454),
  feature("n604", { name: "Quán Hạ Long Xa", amenity: "restaurant" }, 108.5963, 12.7718),
];
const metaFor = (regionKey: string, regionLabel: string, bbox: typeof GAUTENG_BBOX) => ({
  regionKey, regionLabel, sourceName: "Fixture extract", sourceUrl: "https://download.geofabrik.de/africa/south-africa-latest.osm.pbf",
  sourceDataTimestamp: new Date("2026-10-25T21:21:21.000Z"), bbox,
});
const realEstate = (city: string) => ({ countryCode: "ZA", city, industries: ["Real Estate Agencies"] }) as const;

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  const loader = await import("./osm-extract-loader");
  const { OsmExtractProvider } = await import("./osm-extract-provider");
  const provider = (pageSize?: number) => new OsmExtractProvider({ industryFilters: OSM_INDUSTRY_FILTERS, ...(pageSize ? { pageSize } : {}) });
  const loadBoth = async () => {
    await loader.loadOsmExtract(WESTERN_CAPE_LINES, metaFor("western-cape", "Western Cape", WESTERN_CAPE_BBOX));
    await loader.loadOsmExtract(GAUTENG_LINES, metaFor("gauteng", "Gauteng", GAUTENG_BBOX));
  };
  return { db, loader, provider, loadBoth };
}

const names = (page: { records: readonly { name: { value: string } }[] }) => page.records.map((record) => record.name.value);

describe("OpenStreetMap extract with several regions", () => {
  it("keeps both regions ready, and each city is answered from the region that covers it", async () => {
    const { db, provider, loadBoth } = await setup();
    await loadBoth();
    const ready = await db.select({ key: osmDatasets.regionKey }).from(osmDatasets).where(eq(osmDatasets.status, "ready"));
    expect(ready.map((row) => row.key).sort()).toEqual(["gauteng", "western-cape"]);

    const capeTown = await provider().search(realEstate("cape town"));
    expect(names(capeTown)).toEqual(["Fixture Realty Cape Town"]);
    expect(capeTown.provenance).toMatchObject({ dataset_region: "western-cape", search_locality: "Cape Town" });

    const joburg = await provider().search(realEstate("Joburg"));
    expect(joburg.provenance).toMatchObject({ dataset_region: "gauteng", search_locality: "Johannesburg" });
    expect(names(joburg)).toEqual(["Fixture Realty Johannesburg A", "Fixture Realty Johannesburg B", "Fixture Realty Johannesburg C", "Fixture Realty Johannesburg D"]);
    expect(names(joburg).some((name) => name.includes("Cape Town"))).toBe(false);
  });

  it("finds places that are not in the city registry, such as Sandton and Midrand, and respects the search radius", async () => {
    const { provider, loadBoth } = await setup();
    await loadBoth();
    expect(names(await provider().search(realEstate("Sandton")))).toEqual(["Fixture Realty Sandton"]);
    expect(names(await provider().search(realEstate("Midrand")))).toEqual(["Fixture Realty Midrand"]);
    const pretoria = await provider().search(realEstate("Pretoria"));
    expect(names(pretoria)).toEqual(["Fixture Realty Pretoria"]);
    expect(pretoria.provenance).toMatchObject({ dataset_region: "gauteng" });
  });

  it("reports missing coverage explicitly and never leaks results across countries or regions", async () => {
    const { provider, loadBoth } = await setup();
    await loadBoth();
    const p = provider();
    expect(await p.coverage({ countryCode: "VN", city: "Hanoi", industries: ["x"] })).toEqual({ supported: false, reason: "The loaded Gauteng and Western Cape extracts cover South Africa only." });
    await expect(p.search({ countryCode: "VN", city: "Hanoi", industries: ["Real Estate Agencies"] })).rejects.toMatchObject({ code: "unsupported_location" });
    expect(await p.coverage({ countryCode: "ZA", city: "Durban", industries: ["x"] })).toEqual({ supported: false, reason: "Durban is outside the loaded Gauteng and Western Cape extracts." });
    await expect(p.search(realEstate("Durban"))).rejects.toMatchObject({ code: "unsupported_location" });
    await expect(p.search(realEstate("Polokwane"))).rejects.toMatchObject({ code: "invalid_query", message: expect.stringContaining("not in the loaded Gauteng and Western Cape extracts") });
    expect(await p.coverage(realEstate("Johannesburg"))).toMatchObject({ supported: true, basis: "Loaded Gauteng OpenStreetMap extract" });
  });

  it("treats a missing extract as unavailable, not as an empty result", async () => {
    const { provider } = await setup();
    await expect(provider().search(realEstate("Cape Town"))).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(await provider().coverage(realEstate("Cape Town"))).toEqual({ supported: false, reason: "No local OpenStreetMap extract is loaded yet." });
  });

  it("pages deterministically and rejects a page marker from replaced data", async () => {
    const { provider, loader, loadBoth } = await setup();
    await loadBoth();
    const everything = names(await provider().search(realEstate("Johannesburg")));
    const small = provider(2);
    const first = await small.search(realEstate("Johannesburg"));
    expect(first.cursor).toBeDefined();
    const second = await small.search({ ...realEstate("Johannesburg"), ...(first.cursor ? { cursor: first.cursor } : {}) });
    expect([...names(first), ...names(second)]).toEqual(everything);
    expect(second.cursor).toBeUndefined();

    await loader.loadOsmExtract(GAUTENG_LINES, metaFor("gauteng", "Gauteng", GAUTENG_BBOX));
    await expect(small.search({ ...realEstate("Johannesburg"), ...(first.cursor ? { cursor: first.cursor } : {}) })).rejects.toMatchObject({ code: "invalid_query", message: expect.stringContaining("different data") });
  });

  it("lists every dataset with its real row count (the status command)", async () => {
    const { loader, loadBoth } = await setup();
    await loadBoth();
    const rows = await loader.describeExtractDatasets();
    const summary = Object.fromEntries(rows.map((row) => [row.regionKey, { status: row.status, places: row.places, counted: row.approxPlaceRows }]));
    expect(summary["gauteng"]).toEqual({ status: "ready", places: 8, counted: 8 });
    expect(summary["western-cape"]).toEqual({ status: "ready", places: 1, counted: 1 });
  });

  it("reloading one region supersedes only that region", async () => {
    const { db, provider, loader, loadBoth } = await setup();
    await loadBoth();
    await loader.loadOsmExtract(GAUTENG_LINES, metaFor("gauteng", "Gauteng", GAUTENG_BBOX));
    const rows = await db.select({ key: osmDatasets.regionKey, status: osmDatasets.status }).from(osmDatasets);
    expect(rows.filter((row) => row.status === "ready").map((row) => row.key).sort()).toEqual(["gauteng", "western-cape"]);
    expect(rows.filter((row) => row.status === "superseded").map((row) => row.key)).toEqual(["gauteng"]);
    expect(names(await provider().search(realEstate("Cape Town")))).toEqual(["Fixture Realty Cape Town"]);
  });

  it("serves Vietnam as a third region without leaking across countries, and matches decomposed Vietnamese names", async () => {
    const { db, provider, loader, loadBoth } = await setup();
    await loadBoth();
    await loader.loadOsmExtract(VIETNAM_LINES, metaFor("vietnam", "Vietnam", VIETNAM_BBOX));
    const ready = await db.select({ key: osmDatasets.regionKey }).from(osmDatasets).where(eq(osmDatasets.status, "ready"));
    expect(ready.map((row) => row.key).sort()).toEqual(["gauteng", "vietnam", "western-cape"]);
    const p = provider();
    const vn = (city: string, industry: string) => ({ countryCode: "VN", city, industries: [industry] }) as const;

    for (const typed of ["Hanoi", "hà nội", "HA NOI", "Hà Nội"]) {
      const page = await p.search(vn(typed, "IT & Software Companies"));
      expect(names(page), typed).toEqual(["Công Ty Phần Mềm Mẫu"]);
      expect(page.provenance).toMatchObject({ dataset_region: "vietnam", search_locality: "Hà Nội" });
    }
    expect(names(await p.search(vn("Saigon", "Restaurants & Cafés")))).toEqual(["Nhà Hàng Mẫu"]);
    expect(names(await p.search(vn("HCMC", "Restaurants & Cafés")))).toEqual(["Nhà Hàng Mẫu"]);
    expect(await p.coverage(vn("Hanoi", "x"))).toEqual({ supported: true, basis: "Loaded Vietnam OpenStreetMap extract" });

    // Nothing crosses countries, in either direction.
    await expect(p.search(vn("Johannesburg", "Real Estate Agencies"))).rejects.toMatchObject({ code: "invalid_query", message: expect.stringContaining("not in the loaded Vietnam extract") });
    await expect(p.search(realEstate("Hanoi"))).rejects.toMatchObject({ code: "invalid_query", message: expect.stringContaining("not in the loaded Gauteng and Western Cape extracts") });
    expect(names(await p.search(realEstate("Johannesburg"))).every((name) => name.includes("Johannesburg"))).toBe(true);
    expect(await p.coverage({ countryCode: "US", city: "Austin", industries: ["x"] })).toEqual({ supported: false, reason: "The loaded Gauteng, Vietnam and Western Cape extracts cover South Africa and Vietnam only." });
    expect(await p.coverage({ countryCode: "ZA", city: "Durban", industries: ["x"] })).toEqual({ supported: false, reason: "Durban is outside the loaded Gauteng and Western Cape extracts." });
  });

  it("never centres a registry city's search on a same-named place far from it", async () => {
    const { provider, loader } = await setup();
    await loader.loadOsmExtract(VIETNAM_LINES, metaFor("vietnam", "Vietnam", VIETNAM_BBOX));
    for (const typed of ["Ha Long", "Hạ Long", "halong"]) {
      const page = await provider().search({ countryCode: "VN", city: typed, industries: ["Restaurants & Cafés"] });
      expect(names(page), typed).toEqual(["Quán Hạ Long Gần"]);
      expect(page.provenance).toMatchObject({ search_locality: "Hạ Long" });
    }
    // An unregistered place name is still resolved by the existing ranking, because no known centre is available.
    const unregistered = await provider().search({ countryCode: "VN", city: "Hạ Long Bay", industries: ["Restaurants & Cafés"] }).catch((error: unknown) => error);
    expect(unregistered).toMatchObject({ code: "invalid_query" });
  });

  it("does not list a business twice when overlapping datasets both contain it", async () => {
    const { provider, loader } = await setup();
    // A deliberately oversized Western Cape box that also covers Johannesburg, plus Gauteng. Both hold Johannesburg's offices.
    const wide = { minLon: 17.5, minLat: -35, maxLon: 29.5, maxLat: -25 };
    await loader.loadOsmExtract([...WESTERN_CAPE_LINES, ...GAUTENG_LINES], metaFor("western-cape", "Western Cape", wide));
    await loader.loadOsmExtract(GAUTENG_LINES, metaFor("gauteng", "Gauteng", GAUTENG_BBOX));

    const page = await provider().search(realEstate("Johannesburg"));
    expect(page.provenance).toMatchObject({ dataset_region: "gauteng" });
    const ids = page.records.map((record) => record.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
    // The same call is stable: the more specific dataset always wins, whichever was loaded last.
    expect(page.provenance).toEqual((await provider().search(realEstate("Johannesburg"))).provenance);
  });
});
