/**
 * Country and city handling for company discovery.
 *
 * Locations are identified by ISO 3166-1 alpha-2 country code plus a canonical city name; a city name is never
 * unique on its own. The registry below only recognises aliases and supplies approximate coordinates for coverage
 * checks. It is not a list of the only searchable places: any other city passes through unchanged.
 */

export type CountryInfo = Readonly<{
  code: string;
  name: string;
  /** What this country calls its first-level divisions, for form labels. */
  regionLabel: string;
  aliases: readonly string[];
}>;

export const SUPPORTED_COUNTRIES: readonly CountryInfo[] = [
  { code: "ZA", name: "South Africa", regionLabel: "Province", aliases: ["za", "zaf", "rsa", "south africa", "republic of south africa"] },
  { code: "VN", name: "Vietnam", regionLabel: "Province or city", aliases: ["vn", "vnm", "vietnam", "viet nam", "socialist republic of vietnam"] },
];

export type KnownLocation = Readonly<{
  countryCode: string;
  /** Canonical English name shown in the UI and stored on companies. */
  name: string;
  region: string;
  /** Approximate city centre. Used only to decide whether a dataset covers the city, never to search. */
  lat: number;
  lon: number;
  aliases: readonly string[];
  /** Names the place carries in OpenStreetMap, tried in order. */
  osmNames: readonly string[];
}>;

export const KNOWN_LOCATIONS: readonly KnownLocation[] = [
  { countryCode: "ZA", name: "Cape Town", region: "Western Cape", lat: -33.9249, lon: 18.4241, aliases: ["kaapstad", "mother city"], osmNames: ["Cape Town"] },
  { countryCode: "ZA", name: "Johannesburg", region: "Gauteng", lat: -26.2041, lon: 28.0473, aliases: ["joburg", "jozi", "jhb", "egoli"], osmNames: ["Johannesburg"] },
  { countryCode: "ZA", name: "Pretoria", region: "Gauteng", lat: -25.7479, lon: 28.2293, aliases: ["tshwane", "city of tshwane"], osmNames: ["Pretoria"] },
  { countryCode: "ZA", name: "Durban", region: "KwaZulu-Natal", lat: -29.8587, lon: 31.0218, aliases: ["ethekwini"], osmNames: ["Durban"] },
  { countryCode: "ZA", name: "Gqeberha", region: "Eastern Cape", lat: -33.9608, lon: 25.6022, aliases: ["port elizabeth", "nelson mandela bay"], osmNames: ["Gqeberha", "Port Elizabeth"] },
  { countryCode: "ZA", name: "Bloemfontein", region: "Free State", lat: -29.0852, lon: 26.1596, aliases: ["mangaung"], osmNames: ["Bloemfontein"] },
  { countryCode: "VN", name: "Hanoi", region: "Hanoi", lat: 21.0285, lon: 105.8542, aliases: ["ha noi", "hn"], osmNames: ["Hà Nội", "Hanoi"] },
  {
    countryCode: "VN", name: "Ho Chi Minh City", region: "Ho Chi Minh City", lat: 10.8231, lon: 106.6297,
    aliases: ["hcmc", "hcm", "hcm city", "tp hcm", "saigon", "sai gon", "ho chi minh", "thanh pho ho chi minh"],
    osmNames: ["Thành phố Hồ Chí Minh", "Ho Chi Minh City"],
  },
  { countryCode: "VN", name: "Da Nang", region: "Da Nang", lat: 16.0544, lon: 108.2022, aliases: ["danang"], osmNames: ["Đà Nẵng", "Da Nang"] },
  { countryCode: "VN", name: "Hai Phong", region: "Hai Phong", lat: 20.8449, lon: 106.6881, aliases: ["haiphong"], osmNames: ["Hải Phòng", "Hai Phong"] },
  { countryCode: "VN", name: "Ha Long", region: "Quang Ninh", lat: 20.9599, lon: 107.0448, aliases: ["halong", "ha long city"], osmNames: ["Hạ Long", "Ha Long"] },
  { countryCode: "VN", name: "Cam Pha", region: "Quang Ninh", lat: 21.0167, lon: 107.2833, aliases: ["campha", "cam pha city"], osmNames: ["Cẩm Phả", "Cam Pha"] },
];

/**
 * Lower-case, accent-free comparison form: "Hà Nội" and "HA NOI" both become "ha noi". Vietnamese "đ" has no
 * decomposition, so it is mapped explicitly. Only for matching; never store or display the folded value.
 */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Trims and collapses whitespace while keeping every diacritic (NFC). */
export function cleanDisplayText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

const countryIndex = new Map(SUPPORTED_COUNTRIES.flatMap((country) => [country.code.toLowerCase(), country.name, ...country.aliases].map((alias) => [foldText(alias), country] as const)));

export function getCountry(code: string): CountryInfo | undefined {
  return SUPPORTED_COUNTRIES.find((country) => country.code === code);
}

/** Accepts an ISO code or a common country name in any case or accent. */
export function resolveCountry(input: string): CountryInfo | undefined {
  return countryIndex.get(foldText(input));
}

export type ResolvedCity = Readonly<{
  /** Canonical name for registry cities, otherwise the cleaned input. */
  name: string;
  /** What the user typed, cleaned. */
  original: string;
  known: KnownLocation | null;
  /** Names to match in provider data; the cleaned input only for places outside the registry. */
  osmNames: readonly string[];
}>;

/** Resolves a city typed by a user within one country. A name from another country's registry never matches. */
export function resolveCity(countryCode: string, input: string): ResolvedCity {
  const original = cleanDisplayText(input);
  const folded = foldText(original);
  const known = KNOWN_LOCATIONS.find((location) => location.countryCode === countryCode
    && [location.name, ...location.aliases, ...location.osmNames].some((alias) => foldText(alias) === folded)) ?? null;
  return known
    ? { name: known.name, original, known, osmNames: known.osmNames }
    : { name: original, original, known: null, osmNames: [original] };
}

/** Stable key that keeps same-named cities in different countries apart. */
export function locationKey(countryCode: string, cityName: string): string {
  return `${countryCode.toUpperCase()}:${foldText(cityName)}`;
}

export function listKnownCities(countryCode: string): readonly string[] {
  return KNOWN_LOCATIONS.filter((location) => location.countryCode === countryCode).map((location) => location.name);
}

export type BoundingBox = Readonly<{ minLon: number; minLat: number; maxLon: number; maxLat: number }>;

export function bboxContains(box: BoundingBox, lat: number, lon: number): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
}
