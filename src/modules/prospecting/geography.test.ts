import { describe, expect, it } from "vitest";
import { bboxContains, cleanDisplayText, foldText, KNOWN_LOCATIONS, listKnownCities, locationKey, resolveCity, resolveCountry } from "./geography";

describe("foldText", () => {
  it("removes Vietnamese diacritics, including đ, and case", () => {
    expect(foldText("Hà Nội")).toBe("ha noi");
    expect(foldText("ĐÀ NẴNG")).toBe("da nang");
    expect(foldText("Cẩm Phả")).toBe("cam pha");
    expect(foldText("  Ho   Chi-Minh  ")).toBe("ho chi minh");
  });
});

describe("cleanDisplayText", () => {
  it("keeps diacritics and normalises decomposed input to NFC", () => {
    const decomposed = "Hà Nội";
    expect(cleanDisplayText(`  ${decomposed} `)).toBe("Hà Nội".normalize("NFC"));
    expect(cleanDisplayText("Ho  Chi\tMinh")).toBe("Ho Chi Minh");
  });
});

describe("resolveCountry", () => {
  it("accepts ISO codes and names in any case or accent", () => {
    expect(resolveCountry("za")?.code).toBe("ZA");
    expect(resolveCountry("South Africa")?.code).toBe("ZA");
    expect(resolveCountry("VN")?.code).toBe("VN");
    expect(resolveCountry("Việt Nam")?.code).toBe("VN");
    expect(resolveCountry("VIETNAM")?.code).toBe("VN");
  });

  it("returns undefined for unsupported or unknown countries", () => {
    expect(resolveCountry("Atlantis")).toBeUndefined();
    expect(resolveCountry("")).toBeUndefined();
  });
});

describe("resolveCity", () => {
  it("canonicalises case variants", () => {
    expect(resolveCity("ZA", "cape town").name).toBe("Cape Town");
    expect(resolveCity("ZA", "CAPE TOWN").name).toBe("Cape Town");
    expect(resolveCity("VN", "hanoi").name).toBe("Hanoi");
  });

  it("maps Vietnamese names and aliases to the canonical city", () => {
    expect(resolveCity("VN", "Hà Nội").name).toBe("Hanoi");
    expect(resolveCity("VN", "HCMC").name).toBe("Ho Chi Minh City");
    expect(resolveCity("VN", "Saigon").name).toBe("Ho Chi Minh City");
    expect(resolveCity("VN", "Sài Gòn").name).toBe("Ho Chi Minh City");
    expect(resolveCity("VN", "Đà Nẵng").name).toBe("Da Nang");
    expect(resolveCity("VN", "Hải Phòng").name).toBe("Hai Phong");
    expect(resolveCity("VN", "Hạ Long").name).toBe("Ha Long");
    expect(resolveCity("VN", "Cẩm Phả").name).toBe("Cam Pha");
  });

  it("keeps the OpenStreetMap names for matching, including the local-language name", () => {
    expect(resolveCity("VN", "hanoi").osmNames).toEqual(["Hà Nội", "Hanoi"]);
  });

  it("resolves South African aliases", () => {
    expect(resolveCity("ZA", "Joburg").name).toBe("Johannesburg");
    expect(resolveCity("ZA", "Port Elizabeth").name).toBe("Gqeberha");
    expect(resolveCity("ZA", "Tshwane").name).toBe("Pretoria");
  });

  it("passes unregistered cities through unchanged, so the registry is not a limit", () => {
    const city = resolveCity("VN", "  Nha  Trang ");
    expect(city.known).toBeNull();
    expect(city.name).toBe("Nha Trang");
    expect(city.osmNames).toEqual(["Nha Trang"]);
  });

  it("never matches a city registered under a different country", () => {
    expect(resolveCity("VN", "Johannesburg").known).toBeNull();
    expect(resolveCity("ZA", "Hanoi").known).toBeNull();
  });
});

describe("locationKey", () => {
  it("keeps same-named cities in different countries distinct and ignores case and accents", () => {
    expect(locationKey("ZA", "Springfield")).not.toBe(locationKey("US", "Springfield"));
    expect(locationKey("vn", "Hà Nội")).toBe(locationKey("VN", "ha noi"));
  });
});

describe("registry", () => {
  it("covers every initial target city exactly once per country", () => {
    expect(listKnownCities("ZA")).toEqual(["Cape Town", "Johannesburg", "Pretoria", "Durban", "Gqeberha", "Bloemfontein"]);
    expect(listKnownCities("VN")).toEqual(["Hanoi", "Ho Chi Minh City", "Da Nang", "Hai Phong", "Ha Long", "Cam Pha"]);
    expect(new Set(KNOWN_LOCATIONS.map((location) => locationKey(location.countryCode, location.name))).size).toBe(KNOWN_LOCATIONS.length);
  });
});

describe("bboxContains", () => {
  const westernCape = { minLon: 17.5, minLat: -35, maxLon: 24.6, maxLat: -30.2 };

  it("accepts Cape Town and rejects cities outside the box", () => {
    const at = (name: string) => KNOWN_LOCATIONS.find((location) => location.name === name)!;
    expect(bboxContains(westernCape, at("Cape Town").lat, at("Cape Town").lon)).toBe(true);
    for (const name of ["Johannesburg", "Pretoria", "Durban", "Gqeberha", "Bloemfontein", "Hanoi"]) {
      expect(bboxContains(westernCape, at(name).lat, at(name).lon)).toBe(false);
    }
  });
});
