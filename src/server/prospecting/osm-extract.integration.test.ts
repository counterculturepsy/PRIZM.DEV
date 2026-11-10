// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it, vi } from "vitest";
import type { ServerEnv } from "@/config/env";
import { WESTERN_CAPE_BBOX } from "@/modules/prospecting/osm-extract";
import { OSM_INDUSTRY_FILTERS } from "@/modules/prospecting/overpass";
import { createWorkspaceScope } from "@/modules/workspaces/scope";
import { companies, companySources, discoveryRuns, osmDatasets, osmLocalities, osmPlaces, users, workspaceMembers, workspaces } from "@/server/db/schema";

const point = (lon: number, lat: number) => ({ type: "Point", coordinates: [lon, lat] });
const square = (lon: number, lat: number, delta: number) => ({
  type: "Polygon",
  coordinates: [[[lon - delta, lat - delta], [lon + delta, lat - delta], [lon + delta, lat + delta], [lon - delta, lat + delta], [lon - delta, lat - delta]]],
});
const feature = (id: string, properties: Record<string, string>, geometry: unknown) =>
  `\u001e${JSON.stringify({ type: "Feature", id, geometry, properties })}`;

const realtyOne = feature("n1", { name: "Fixture Realty One", office: "estate_agent", website: "fixture-realty-one.example", phone: "+27 21 555 0111" }, point(18.861, -33.93011));
const FIXTURE_LINES = [
  feature("n9001", { name: "Stellenbosch", place: "town", population: "77000" }, point(18.861, -33.9346)),
  feature("n9002", { name: "Stellenbosch", place: "suburb" }, point(18.95, -33.9)),
  feature("n9003", { name: "Somerset West", place: "town", population: "31000" }, point(18.843, -34.078)),
  feature("n9004", { name: "Cape Town", place: "city", population: "4000000" }, point(18.4241, -33.9249)),
  realtyOne,
  feature("w2", { name: "Fixture Realty Two", office: "estate_agent", "addr:housenumber": "5", "addr:street": "Fixture Street", "addr:city": "Stellenbosch" }, square(18.8935, -33.9346, 0.0005)),
  feature("n3", { name: "Fixture Realty Three", office: "estate_agent" }, point(18.7635, -33.9346)),
  feature("n4", { name: "Fixture Realty Cape Town", office: "estate_agent" }, point(18.4241, -33.9249)),
  feature("n5", { name: "Fixture Law One", office: "lawyer" }, point(18.865, -33.93)),
  feature("n6", { name: "Fixture Cafe One", amenity: "cafe" }, point(18.859, -33.94)),
  feature("a1001", { name: "Fixture Realty Relation", office: "estate_agent" }, square(18.87, -33.94, 0.0004)),
  feature("n7", { name: "Fixture Realty Johannesburg", office: "estate_agent" }, point(28.0473, -26.2041)),
  feature("n8", { office: "estate_agent" }, point(18.86, -33.93)),
  feature("n10", { name: "Fixture Bakery", shop: "bakery" }, point(18.86, -33.93)),
  "{not valid json",
  realtyOne,
];
const meta = {
  regionKey: "western-cape",
  regionLabel: "Western Cape",
  sourceName: "Fixture extract",
  sourceUrl: "https://download.geofabrik.de/africa/south-africa-latest.osm.pbf",
  sourceDataTimestamp: new Date("2026-10-25T21:21:21.000Z"),
  bbox: WESTERN_CAPE_BBOX,
};
const search = { countryCode: "ZA", city: "Stellenbosch", industries: ["Real Estate Agencies"] } as const;
const later = (minutes: number) => () => new Date(Date.now() + minutes * 60_000);

async function setup() {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  const [user] = await db.insert(users).values({ email: "owner@example.com" }).returning({ id: users.id });
  const rows = await db.insert(workspaces).values([{ name: "Alpha", slug: "alpha" }, { name: "Beta", slug: "beta" }]).returning({ id: workspaces.id });
  const [alpha, beta] = rows;
  if (!user || !alpha || !beta) throw new Error("Test fixtures were not created");
  await db.insert(workspaceMembers).values([
    { workspaceId: alpha.id, userId: user.id, role: "owner", status: "active" },
    { workspaceId: beta.id, userId: user.id, role: "owner", status: "active" },
  ]);
  vi.resetModules();
  vi.doMock("@/server/db", () => ({ getDatabase: () => db }));
  return {
    client, db,
    loader: await import("./osm-extract-loader"),
    providerModule: await import("./osm-extract-provider"),
    discovery: await import("./discovery"),
    imports: await import("./imports"),
    alpha: createWorkspaceScope({ workspaceId: alpha.id, userId: user.id, role: "owner" }),
    beta: createWorkspaceScope({ workspaceId: beta.id, userId: user.id, role: "owner" }),
  };
}

describe("local OpenStreetMap extract", () => {
  it("loads a synthetic extract into the separate schema and reports exactly what was skipped", async () => {
    const { client, db, loader } = await setup();
    const result = await loader.loadOsmExtract(FIXTURE_LINES, meta);

    expect(result).toMatchObject({ places: 7, localities: 4 });
    expect(result.skipped).toEqual({ outside_bbox: 1, missing_name: 1, no_match: 1, invalid_json: 1, duplicate: 1 });
    expect(result.industries["Real Estate Agencies"]).toBe(5);
    const [dataset] = await db.select().from(osmDatasets);
    expect(dataset).toMatchObject({ status: "ready", placeCount: 7, localityCount: 4, skippedCount: 5, loaderVersion: "osm-extract-v1", attribution: "© OpenStreetMap contributors" });
    expect(await db.select().from(osmPlaces)).toHaveLength(7);
    expect(await db.select().from(companies)).toHaveLength(0);
    const scan = await loader.scanExtract(FIXTURE_LINES, { bbox: WESTERN_CAPE_BBOX });
    expect(scan).toMatchObject({ places: 7, localities: 4, skipped: { duplicate: 1, outside_bbox: 1, missing_name: 1, no_match: 1, invalid_json: 1 } });
    expect(await db.select().from(osmDatasets)).toHaveLength(1);
    await client.close();
  });

  it("searches by distance from a named place, within the radius and industry, nearest first", async () => {
    const { client, loader, providerModule } = await setup();
    await loader.loadOsmExtract(FIXTURE_LINES, meta);
    const provider = new providerModule.OsmExtractProvider({ industryFilters: OSM_INDUSTRY_FILTERS });

    const page = await provider.search({ ...search, city: "stellenbosch" });
    expect(page.records.map((record) => record.externalId)).toEqual(["node/1", "relation/500", "way/2", "node/3"]);
    expect(page.cursor).toBeUndefined();
    expect(page.provenance).toMatchObject({ dataset_region: "western-cape", dataset_data_timestamp: "2026-10-25T21:21:21.000Z", search_locality: "Stellenbosch", search_radius_km: "10" });

    const [first, , second] = page.records;
    expect(first).toMatchObject({ website: { value: "fixture-realty-one.example" }, phone: { value: "+27 21 555 0111" }, city: { value: "Stellenbosch", kind: "inferred", source: "openstreetmap:search-area" }, industry: { value: "Real Estate Agencies" } });
    expect(second).toMatchObject({ address: { value: "5 Fixture Street" }, city: { value: "Stellenbosch", kind: "observed" }, sourceUrl: "https://www.openstreetmap.org/way/2" });
    expect(first?.name).toMatchObject({ kind: "observed", confidence: "medium", observedAt: "2026-10-25T21:21:21.000Z" });

    const near = await provider.search({ ...search, radiusKm: 2 });
    expect(near.records.map((record) => record.externalId)).toEqual(["node/1", "relation/500"]);
    const lawyers = await provider.search({ ...search, industries: ["Legal & Accounting Services"] });
    expect(lawyers.records.map((record) => record.externalId)).toEqual(["node/5"]);
    await client.close();
  });

  it("pages with a keyset cursor and rejects a tampered one", async () => {
    const { client, loader, providerModule } = await setup();
    await loader.loadOsmExtract(FIXTURE_LINES, meta);
    const provider = new providerModule.OsmExtractProvider({ industryFilters: OSM_INDUSTRY_FILTERS, pageSize: 2 });

    const first = await provider.search(search);
    expect(first.records.map((record) => record.externalId)).toEqual(["node/1", "relation/500"]);
    expect(first.cursor).toBeTypeOf("string");
    const second = await provider.search({ ...search, ...(first.cursor ? { cursor: first.cursor } : {}) });
    expect(second.records.map((record) => record.externalId)).toEqual(["way/2", "node/3"]);
    expect(second.cursor).toBeUndefined();

    await expect(provider.search({ ...search, cursor: "not-a-cursor" })).rejects.toMatchObject({ code: "invalid_query" });
    await expect(provider.search({ ...search, cursor: Buffer.from(JSON.stringify({ d: -1, i: 1 })).toString("base64url") })).rejects.toMatchObject({ code: "invalid_query" });
    await client.close();
  });

  it("fails clearly for missing data, unknown places and invalid searches", async () => {
    const { client, loader, providerModule } = await setup();
    const provider = new providerModule.OsmExtractProvider({ industryFilters: OSM_INDUSTRY_FILTERS });
    await expect(provider.search(search)).rejects.toMatchObject({ code: "provider_unavailable", message: expect.stringContaining("No local OpenStreetMap extract") });

    await loader.loadOsmExtract(FIXTURE_LINES, meta);
    await expect(provider.search({ ...search, city: "Nowhereville" })).rejects.toMatchObject({ code: "invalid_query", message: expect.stringContaining("Western Cape") });
    await expect(provider.search({ countryCode: "ZA", industries: ["Real Estate Agencies"] })).rejects.toMatchObject({ code: "invalid_query" });
    await expect(provider.search({ ...search, industries: ["Plumbers"] })).rejects.toMatchObject({ code: "invalid_query" });
    await expect(provider.search({ ...search, city: "Stellenbosch'; drop table osm_source.places;--" })).rejects.toMatchObject({ code: "invalid_query" });
    await client.close();
  });

  it("publishes a new dataset atomically, keeps the old one on failure, and purges what is inactive", async () => {
    const { client, db, loader, providerModule } = await setup();
    const provider = new providerModule.OsmExtractProvider({ industryFilters: OSM_INDUSTRY_FILTERS });
    const first = await loader.loadOsmExtract(FIXTURE_LINES, meta);

    async function* failingLines() {
      yield* FIXTURE_LINES.slice(0, 8);
      throw new Error("disk read failed");
    }
    await expect(loader.loadOsmExtract(failingLines(), meta)).rejects.toThrow("disk read failed");
    const afterFailure = await db.select().from(osmDatasets);
    expect(afterFailure.map((row) => row.status).sort()).toEqual(["failed", "ready"]);
    expect((await provider.search(search)).records).toHaveLength(4);
    const failed = afterFailure.find((row) => row.status === "failed");
    expect(await db.select().from(osmPlaces).where(eq(osmPlaces.datasetId, failed?.id ?? ""))).toHaveLength(0);

    await expect(loader.loadOsmExtract(["{broken"], meta)).rejects.toThrow("no usable");
    const smaller = [FIXTURE_LINES[0], FIXTURE_LINES[4]].filter((value): value is string => Boolean(value));
    const second = await loader.loadOsmExtract(smaller, meta);
    const statuses = Object.fromEntries((await db.select().from(osmDatasets)).map((row) => [row.id, row.status]));
    expect(statuses[first.datasetId]).toBe("superseded");
    expect(statuses[second.datasetId]).toBe("ready");
    expect((await provider.search(search)).records.map((record) => record.externalId)).toEqual(["node/1"]);

    expect(await loader.purgeInactiveExtractDatasets()).toBe(3);
    expect((await db.select().from(osmDatasets)).map((row) => row.id)).toEqual([second.datasetId]);
    expect(await db.select().from(osmPlaces).where(eq(osmPlaces.datasetId, first.datasetId))).toHaveLength(0);
    expect(await db.select().from(osmLocalities)).toHaveLength(1);
    await client.close();
  });

  it("feeds workspace companies with attribution while the extract stays global and separate", async () => {
    const { client, db, loader, providerModule, discovery, imports, alpha, beta } = await setup();
    await loader.loadOsmExtract(FIXTURE_LINES, meta);
    await imports.importCompanyCsv(alpha, "name,website,industry\nMy Own Name For Realty One,fixture-realty-one.example,Property (mine)");
    const provider = new providerModule.OsmExtractProvider({ industryFilters: OSM_INDUSTRY_FILTERS });
    const input = { industry: "Real Estate Agencies", city: "Stellenbosch" };

    await expect(discovery.runCompanyDiscovery(alpha, input, { provider })).resolves.toMatchObject({ found: 4, created: 3, alreadyKnown: 1 });
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider })).rejects.toBeInstanceOf(discovery.DiscoveryRateLimitedError);
    await expect(discovery.runCompanyDiscovery(alpha, input, { provider, now: later(1) })).resolves.toMatchObject({ created: 0, alreadyKnown: 4 });

    const mine = (await db.select().from(companies).where(eq(companies.workspaceId, alpha.workspaceId))).find((company) => company.domain === "fixture-realty-one.example");
    expect(mine).toMatchObject({ name: "My Own Name For Realty One", industry: "Property (mine)", phone: "+27 21 555 0111" });
    const sources = await db.select().from(companySources).where(eq(companySources.provider, "osm_extract"));
    expect(sources).toHaveLength(4);
    expect(sources.every((source) => source.observedAt.toISOString() === "2026-10-25T21:21:21.000Z")).toBe(true);
    expect(sources.every((source) => Math.abs(source.createdAt.getTime() - Date.now()) < 60_000)).toBe(true);
    const csvSource = (await db.select().from(companySources).where(eq(companySources.provider, "csv")))[0];
    expect(Math.abs((csvSource?.observedAt.getTime() ?? 0) - (csvSource?.createdAt.getTime() ?? 1))).toBeLessThan(5_000);
    expect(sources.every((source) => source.kind === "observed" && source.sourceUrl?.startsWith("https://www.openstreetmap.org/"))).toBe(true);
    expect(sources[0]?.snapshot).toMatchObject({ dataset_region: "western-cape", dataset_data_timestamp: "2026-10-25T21:21:21.000Z", search_locality: "Stellenbosch", basis_city: "search_area" });
    const runs = await db.select().from(discoveryRuns).where(eq(discoveryRuns.provider, "osm_extract"));
    expect(runs.every((run) => run.status === "completed")).toBe(true);

    expect(await db.select().from(companies).where(eq(companies.workspaceId, beta.workspaceId))).toHaveLength(0);
    await expect(discovery.runCompanyDiscovery(beta, input, { provider })).resolves.toMatchObject({ created: 4 });
    expect(await db.select().from(companies).where(eq(companies.workspaceId, alpha.workspaceId))).toHaveLength(4);
    expect(await db.select().from(osmPlaces)).toHaveLength(7);
    await client.close();
  });

  it("refuses to publish a dataset when fewer lines were read than the file holds", async () => {
    const { client, db, loader, providerModule } = await setup();
    const good = await loader.loadOsmExtract(FIXTURE_LINES, meta, { expectedLines: FIXTURE_LINES.length });
    await expect(loader.loadOsmExtract(FIXTURE_LINES.slice(5), meta, { expectedLines: FIXTURE_LINES.length })).rejects.toThrow("so nothing was published");

    const rows = await db.select().from(osmDatasets);
    expect(rows.map((row) => row.status).sort()).toEqual(["failed", "ready"]);
    expect(rows.find((row) => row.status === "ready")?.id).toBe(good.datasetId);
    const failed = rows.find((row) => row.status === "failed");
    expect(await db.select().from(osmPlaces).where(eq(osmPlaces.datasetId, failed?.id ?? ""))).toHaveLength(0);
    expect(await db.select().from(osmLocalities).where(eq(osmLocalities.datasetId, failed?.id ?? ""))).toHaveLength(0);

    const provider = new providerModule.OsmExtractProvider({ industryFilters: OSM_INDUSTRY_FILTERS });
    expect((await provider.search(search)).records).toHaveLength(4);
    await client.close();
  });

  it("is selected only by explicit configuration", async () => {
    const { client, discovery } = await setup();
    expect(discovery.createDiscoveryProvider({ DISCOVERY_PROVIDER: "none" } as ServerEnv)).toBeNull();
    const provider = discovery.createDiscoveryProvider({ DISCOVERY_PROVIDER: "osm_extract", OSM_EXTRACT_RADIUS_KM: 5 } as ServerEnv);
    expect(provider?.id).toBe("osm_extract");
    expect(provider?.limits?.minIntervalSeconds).toBe(2);
    expect(discovery.getDiscoveryStatus({ DISCOVERY_PROVIDER: "osm_extract" } as ServerEnv)).toMatchObject({ enabled: true, providerName: "OpenStreetMap extract (local)" });
    await client.close();
  });
});
