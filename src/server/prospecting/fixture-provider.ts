import { foldText, resolveCity } from "@/modules/prospecting/geography";
import { assertKeyword } from "@/modules/prospecting/overpass";
import {
  DiscoveryProviderError,
  type BusinessSearchPage,
  type BusinessSearchQuery,
  type BusinessSearchRecord,
  type CoverageDecision,
  type DiscoveryProvider,
  type ProviderCapabilities,
  type ProviderLicense,
  type SourcedValue,
} from "@/modules/prospecting/providers";

export const FIXTURE_PROVIDER_ID = "fixture";
const OBSERVED_AT = "2026-11-23T00:00:00.000Z";
const DEFAULT_PAGE_SIZE = 3;

type FixtureBusiness = Readonly<{
  id: string;
  name: string;
  countryCode: string;
  city: string;
  region: string;
  industry: string;
  website?: string;
  phone?: string;
  address?: string;
}>;

/**
 * Synthetic businesses for local browser and integration testing only. Every name carries a [FIXTURE] marker and every
 * website uses the reserved `.test` TLD, so none of this can be mistaken for, or resolve to, a real company. The
 * provider is labelled "synthetic_fixture" and the UI shows a banner whenever it answers a search.
 */
export const FIXTURE_BUSINESSES: readonly FixtureBusiness[] = [
  { id: "vn-hanoi-restaurant-1", name: "Quán Phở Hà Nội [FIXTURE]", countryCode: "VN", city: "Hanoi", region: "Hanoi", industry: "Restaurants & Cafés", website: "https://fixture-quan-pho.example.test", phone: "+84 24 0000 0001", address: "12 Phố Hàng Bạc" },
  { id: "vn-hanoi-restaurant-2", name: "Bún Chả Phố Cổ [FIXTURE]", countryCode: "VN", city: "Hanoi", region: "Hanoi", industry: "Restaurants & Cafés", website: "https://fixture-bun-cha.example.test", address: "5 Phố Hàng Mã" },
  { id: "vn-hanoi-restaurant-3", name: "Cà Phê Trứng Mẫu [FIXTURE]", countryCode: "VN", city: "Hanoi", region: "Hanoi", industry: "Restaurants & Cafés" },
  { id: "vn-hanoi-restaurant-4", name: "Nhà Hàng Hồ Gươm [FIXTURE]", countryCode: "VN", city: "Hanoi", region: "Hanoi", industry: "Restaurants & Cafés", website: "https://fixture-ho-guom.example.test" },
  { id: "vn-hanoi-it-1", name: "Công Ty Phần Mềm Hà Nội [FIXTURE]", countryCode: "VN", city: "Hanoi", region: "Hanoi", industry: "IT & Software Companies", website: "https://fixture-phan-mem.example.test", phone: "+84 24 0000 0002" },
  { id: "vn-hanoi-it-2", name: "Hanoi Cloud Studio [FIXTURE]", countryCode: "VN", city: "Hanoi", region: "Hanoi", industry: "IT & Software Companies", website: "https://fixture-cloud-studio.example.test" },
  { id: "vn-hcmc-restaurant-1", name: "Cơm Tấm Sài Gòn [FIXTURE]", countryCode: "VN", city: "Ho Chi Minh City", region: "Ho Chi Minh City", industry: "Restaurants & Cafés", website: "https://fixture-com-tam.example.test" },
  { id: "vn-hcmc-restaurant-2", name: "Phở Quận Một [FIXTURE]", countryCode: "VN", city: "Ho Chi Minh City", region: "Ho Chi Minh City", industry: "Restaurants & Cafés" },
  { id: "za-johannesburg-it-1", name: "Sandton Software Works [FIXTURE]", countryCode: "ZA", city: "Johannesburg", region: "Gauteng", industry: "IT & Software Companies", website: "https://fixture-sandton-software.example.test", phone: "+27 11 000 0001", address: "1 Rivonia Road" },
  { id: "za-johannesburg-it-2", name: "Rosebank Cloud Consulting [FIXTURE]", countryCode: "ZA", city: "Johannesburg", region: "Gauteng", industry: "IT & Software Companies", website: "https://fixture-rosebank-cloud.example.test" },
  { id: "za-johannesburg-it-3", name: "Braamfontein Dev Collective [FIXTURE]", countryCode: "ZA", city: "Johannesburg", region: "Gauteng", industry: "IT & Software Companies" },
  { id: "za-johannesburg-restaurant-1", name: "Melville Kitchen [FIXTURE]", countryCode: "ZA", city: "Johannesburg", region: "Gauteng", industry: "Restaurants & Cafés", website: "https://fixture-melville-kitchen.example.test" },
];

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString("base64url");
}

function decodeCursor(cursor: string): number {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const offset = Number(decoded);
  if (!/^\d{1,6}$/.test(decoded) || !Number.isInteger(offset)) throw new DiscoveryProviderError("invalid_query", "The page marker is not valid. Start the search again.");
  return offset;
}

function hasCityData(countryCode: string, cityName: string): boolean {
  return FIXTURE_BUSINESSES.some((business) => business.countryCode === countryCode && foldText(business.city) === foldText(cityName));
}

/** Deterministic, offline provider with a few synthetic businesses per city. Never a live source. */
export class FixtureProvider implements DiscoveryProvider {
  readonly id = FIXTURE_PROVIDER_ID;
  readonly displayName = "Synthetic test fixtures";
  readonly license: ProviderLicense = {
    name: "Synthetic data, not real businesses",
    url: "#fixture-data-notice",
    attribution: "are synthetic local test fixtures",
  };
  readonly limits = { minIntervalSeconds: 0, maxPerHour: 600, maxPerDay: 3000, inProgressSeconds: 60, providerCooldownSeconds: 0 };
  readonly capabilities: ProviderCapabilities = {
    countries: ["ZA", "VN"], region: false, city: true, industry: true, keyword: true, pagination: "cursor", dataKind: "synthetic_fixture",
  };

  constructor(private readonly options: Readonly<{ pageSize?: number }> = {}) {}

  async coverage(query: BusinessSearchQuery): Promise<CoverageDecision> {
    if (!query.city) return { supported: false, reason: "Choose a city." };
    const city = resolveCity(query.countryCode, query.city);
    return hasCityData(query.countryCode, city.name)
      ? { supported: true, basis: "Synthetic fixture data (not live)" }
      : { supported: false, reason: `The synthetic fixtures have no data for ${city.name}.` };
  }

  async search(query: BusinessSearchQuery): Promise<BusinessSearchPage> {
    if (!query.city) throw new DiscoveryProviderError("invalid_query", "Choose a city.");
    const city = resolveCity(query.countryCode, query.city);
    if (!hasCityData(query.countryCode, city.name)) {
      throw new DiscoveryProviderError("unsupported_location", `The synthetic fixtures have no data for ${city.name}.`);
    }
    const industry = query.industries[0];
    const keyword = query.keyword ? foldText(assertKeyword(query.keyword)) : undefined;
    const matches = FIXTURE_BUSINESSES.filter((business) => business.countryCode === query.countryCode
      && foldText(business.city) === foldText(city.name)
      && business.industry === industry
      && (!keyword || foldText(business.name).includes(keyword)));

    const pageSize = this.options.pageSize ?? DEFAULT_PAGE_SIZE;
    const offset = query.cursor ? decodeCursor(query.cursor) : 0;
    const page = matches.slice(offset, offset + pageSize);
    const fact = (value: string): SourcedValue<string> => ({ value, kind: "observed", confidence: "low", source: "fixture", observedAt: OBSERVED_AT });
    const records = page.map((business): BusinessSearchRecord => ({
      externalId: `fixture/${business.id}`,
      name: fact(business.name),
      ...(business.website ? { website: fact(business.website) } : {}),
      ...(business.phone ? { phone: fact(business.phone) } : {}),
      ...(business.address ? { address: fact(business.address) } : {}),
      city: fact(business.city),
      province: fact(business.region),
      industry: fact(business.industry),
    }));
    return {
      records,
      ...(offset + pageSize < matches.length ? { cursor: encodeCursor(offset + pageSize) } : {}),
      provenance: { dataset_id: "fixture", dataset_data_timestamp: OBSERVED_AT, data_kind: "synthetic_fixture" },
    };
  }
}
