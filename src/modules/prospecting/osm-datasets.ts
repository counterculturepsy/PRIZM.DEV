import { bboxContains, getCountry, resolveCity, type BoundingBox } from "./geography";
import type { BusinessSearchQuery } from "./providers";

/**
 * Which loaded OpenStreetMap datasets may answer a query. Pure and deterministic: the same datasets and query always
 * give the same candidates in the same order, so paging and provenance stay stable when several datasets coexist.
 */
export type DatasetInfo = Readonly<{ id: string; regionKey: string; regionLabel: string; bbox: BoundingBox }>;

/**
 * Country of each loadable extract region. A region that is not listed here is treated as covering nothing, so loading
 * a new extract never makes it answer searches until its country has been stated here on purpose.
 */
export const OSM_EXTRACT_REGION_COUNTRY: Readonly<Record<string, string>> = {
  "western-cape": "ZA",
  gauteng: "ZA",
  vietnam: "VN",
};

export function datasetCountry(regionKey: string): string | undefined {
  return Object.hasOwn(OSM_EXTRACT_REGION_COUNTRY, regionKey) ? OSM_EXTRACT_REGION_COUNTRY[regionKey] : undefined;
}

const bboxArea = (box: BoundingBox) => (box.maxLon - box.minLon) * (box.maxLat - box.minLat);

/** Smaller (more specific) boxes first. Ties break on region key, then id, so the order never depends on load order. */
export function bySpecificity(a: DatasetInfo, b: DatasetInfo): number {
  return bboxArea(a.bbox) - bboxArea(b.bbox) || a.regionKey.localeCompare(b.regionKey) || a.id.localeCompare(b.id);
}

function labelList(datasets: readonly DatasetInfo[]): string {
  const labels = [...new Set(datasets.map((dataset) => dataset.regionLabel))].sort();
  return labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

const extractNoun = (count: number) => (count === 1 ? "extract" : "extracts");

export type DatasetSelection = Readonly<
  | { supported: true; candidates: readonly DatasetInfo[]; basis: string }
  | { supported: false; reason: string }
>;

export function selectCandidateDatasets(datasets: readonly DatasetInfo[], query: BusinessSearchQuery): DatasetSelection {
  if (datasets.length === 0) return { supported: false, reason: "No local OpenStreetMap extract is loaded yet." };

  const inCountry = datasets.filter((dataset) => datasetCountry(dataset.regionKey) === query.countryCode);
  if (inCountry.length === 0) {
    const covered = [...new Set(datasets.flatMap((dataset) => datasetCountry(dataset.regionKey) ?? []))]
      .map((code) => getCountry(code)?.name ?? code).sort();
    const verb = datasets.length === 1 ? "covers" : "cover";
    return { supported: false, reason: `The loaded ${labelList(datasets)} ${extractNoun(datasets.length)} ${verb} ${covered.length ? covered.join(" and ") : "no verified country"} only.` };
  }

  let candidates = inCountry;
  if (query.city) {
    const known = resolveCity(query.countryCode, query.city).known;
    if (known) {
      candidates = inCountry.filter((dataset) => bboxContains(dataset.bbox, known.lat, known.lon));
      if (candidates.length === 0) {
        return { supported: false, reason: `${known.name} is outside the loaded ${labelList(inCountry)} ${extractNoun(inCountry.length)}.` };
      }
    }
  }
  const ordered = candidates.toSorted(bySpecificity);
  return { supported: true, candidates: ordered, basis: `Loaded ${labelList(ordered)} OpenStreetMap ${extractNoun(ordered.length)}` };
}
