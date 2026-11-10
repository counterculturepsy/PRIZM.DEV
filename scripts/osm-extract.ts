import { statSync } from "node:fs";
import { buildTagsFilterExpressions, type Bbox, WESTERN_CAPE_BBOX } from "../src/modules/prospecting/osm-extract";
import { OSM_INDUSTRY_FILTERS } from "../src/modules/prospecting/overpass";
import {
  describeExtractDatasets,
  loadOsmExtract,
  purgeInactiveExtractDatasets,
  scanExtract,
} from "../src/server/prospecting/osm-extract-loader";
import { countLines, streamLines } from "../src/server/prospecting/osm-extract-file";

const USAGE = `PRIZM.DEV local OpenStreetMap extract tool

  expressions                       Print the osmium tags-filter expressions (no files, no database).
  scan  --file <geojsonseq>         Parse a file and report counts. No database access.
  status                            List loaded datasets (read-only database access).
  load  --file <geojsonseq> --data-timestamp <ISO-8601> --confirm-write
                                    Load a file into the osm_source schema. Writes to the database.
  purge --confirm-write             Delete failed, superseded and stale datasets. Writes to the database.

Options for scan/load:
  --bbox minLon,minLat,maxLon,maxLat   Keep only features inside this box (default: approximate Western Cape).
  --region-key <key>                   Default: western-cape
  --region-label <label>               Default: Western Cape
  --source-url <url>                   Default: the Geofabrik South Africa extract URL
  --sha256 <hex>                       Optional checksum of the source file, stored with the dataset
`;

const DEFAULT_SOURCE_URL = "https://download.geofabrik.de/africa/south-africa-latest.osm.pbf";

function parseArgs(argv: readonly string[]): { command: string; flags: Map<string, string>; confirmWrite: boolean } {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string>();
  let confirmWrite = false;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index] ?? "";
    if (argument === "--confirm-write") confirmWrite = true;
    else if (argument.startsWith("--")) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      flags.set(argument.slice(2), value);
      index += 1;
    } else throw new Error(`Unexpected argument: ${argument}`);
  }
  return { command, flags, confirmWrite };
}

function parseBbox(value: string | undefined): Bbox {
  if (!value) return WESTERN_CAPE_BBOX;
  const parts = value.split(",").map(Number);
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)) || minLon === undefined || minLat === undefined || maxLon === undefined || maxLat === undefined) {
    throw new Error("--bbox must be four numbers: minLon,minLat,maxLon,maxLat");
  }
  if (minLon >= maxLon || minLat >= maxLat) throw new Error("--bbox minimums must be smaller than maximums.");
  return { minLon, minLat, maxLon, maxLat };
}

function fileLines(path: string): AsyncIterable<string> {
  const size = statSync(path).size;
  console.log(`Reading ${path} (${(size / 1_048_576).toFixed(1)} MB)`);
  return streamLines(path);
}

/** Scans a file and refuses to report counts unless every line in the file was actually read. */
async function scanFile(path: string, bbox: Bbox) {
  const expected = await countLines(path);
  const result = await scanExtract(fileLines(path), { bbox });
  if (result.lines !== expected) throw new Error(`Read ${result.lines} lines but the file has ${expected}. The counts cannot be trusted.`);
  return result;
}

function printResult(result: { lines: number; places: number; localities: number; skipped: object; industries: Record<string, number> }): void {
  console.log(`Lines read: ${result.lines}`);
  console.log(`Businesses: ${result.places}, named places: ${result.localities}`);
  console.log("Skipped:", JSON.stringify(result.skipped));
  console.log("Businesses by industry:", JSON.stringify(result.industries, null, 2));
}

async function main(): Promise<void> {
  const { command, flags, confirmWrite } = parseArgs(process.argv.slice(2));
  const bbox = parseBbox(flags.get("bbox"));

  if (command === "expressions") {
    console.log(buildTagsFilterExpressions(OSM_INDUSTRY_FILTERS).join("\n"));
    return;
  }
  if (command === "scan") {
    const file = flags.get("file");
    if (!file) throw new Error("scan needs --file");
    printResult(await scanFile(file, bbox));
    return;
  }
  if (command === "status") {
    console.table(await describeExtractDatasets());
    return;
  }
  if (command === "load") {
    const file = flags.get("file");
    const timestamp = flags.get("data-timestamp");
    if (!file || !timestamp) throw new Error("load needs --file and --data-timestamp");
    const sourceDataTimestamp = new Date(timestamp);
    if (Number.isNaN(sourceDataTimestamp.getTime())) throw new Error("--data-timestamp must be an ISO-8601 date, for example 2026-10-25T21:21:21Z");
    if (!confirmWrite) {
      console.log("Dry run only: add --confirm-write to write to the database. Scanning the file instead.");
      printResult(await scanFile(file, bbox));
      return;
    }
    const result = await loadOsmExtract(fileLines(file), {
      regionKey: flags.get("region-key") ?? "western-cape",
      regionLabel: flags.get("region-label") ?? "Western Cape",
      sourceName: "Geofabrik South Africa extract",
      sourceUrl: flags.get("source-url") ?? DEFAULT_SOURCE_URL,
      sourceDataTimestamp,
      ...(flags.get("sha256") ? { sourceSha256: flags.get("sha256") as string } : {}),
      bbox,
    }, { expectedLines: await countLines(file) });
    console.log(`Dataset ${result.datasetId} is ready.`);
    printResult(result);
    return;
  }
  if (command === "purge") {
    if (!confirmWrite) {
      console.log("Dry run only: add --confirm-write to delete inactive datasets. Current datasets:");
      console.table(await describeExtractDatasets());
      return;
    }
    console.log(`Removed ${await purgeInactiveExtractDatasets()} inactive dataset(s).`);
    return;
  }
  console.log(USAGE);
  process.exitCode = command ? 1 : 0;
}

main().then(() => process.exit(process.exitCode ?? 0), (error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unexpected error");
  process.exit(1);
});
