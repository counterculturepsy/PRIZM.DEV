import { describe, expect, it } from "vitest";
import { opportunityTypes } from "./generator";
import { assessPrice, describeRecommendationPrice, LEGACY_SERVICE_ALIASES, resolveRecommendations } from "./mapping";

const service = (id: string, name: string, extra: Partial<{ active: boolean; startingPriceMinor: number | null; averagePriceMinor: number | null }> = {}) => ({
  id, name, active: true, startingPriceMinor: null, averagePriceMinor: null, ...extra,
});

describe("resolveRecommendations", () => {
  it("orders preferred first, then name, then id", () => {
    const result = resolveRecommendations(
      [
        { serviceId: "3", isPreferred: false },
        { serviceId: "2", isPreferred: false },
        { serviceId: "1", isPreferred: true },
        { serviceId: "4", isPreferred: false },
      ],
      [service("1", "Zeta"), service("2", "Alpha"), service("3", "alpha"), service("4", "Beta")],
      "ZAR",
    );
    expect(result.map((item) => item.serviceId)).toEqual(["1", "2", "3", "4"]);
    expect(result.map((item) => item.rank)).toEqual([1, 2, 3, 4]);
  });

  it("is deterministic regardless of mapping input order", () => {
    const services = [service("a", "Same"), service("b", "Same"), service("c", "Same")];
    const forward = resolveRecommendations([{ serviceId: "a", isPreferred: false }, { serviceId: "b", isPreferred: false }, { serviceId: "c", isPreferred: false }], services, "ZAR");
    const reverse = resolveRecommendations([{ serviceId: "c", isPreferred: false }, { serviceId: "b", isPreferred: false }, { serviceId: "a", isPreferred: false }], services, "ZAR");
    expect(forward).toEqual(reverse);
  });

  it("recommends services without prices and never invents a price or currency", () => {
    const [item] = resolveRecommendations([{ serviceId: "1", isPreferred: false }], [service("1", "No price")], "ZAR");
    expect(item).toMatchObject({ priceStatus: "not_configured", startingPriceMinor: null, averagePriceMinor: null, currency: null });
  });

  it("carries configured prices with the workspace currency and hides invalid ones", () => {
    const [priced, broken] = resolveRecommendations(
      [{ serviceId: "p", isPreferred: true }, { serviceId: "x", isPreferred: false }],
      [service("p", "Priced", { startingPriceMinor: 10_000, averagePriceMinor: 20_000 }), service("x", "Inverted", { startingPriceMinor: 30_000, averagePriceMinor: 20_000 })],
      "USD",
    );
    expect(priced).toMatchObject({ priceStatus: "configured", startingPriceMinor: 10_000, averagePriceMinor: 20_000, currency: "USD" });
    expect(broken).toMatchObject({ priceStatus: "invalid", startingPriceMinor: null, averagePriceMinor: null, currency: null });
    expect(assessPrice(service("n", "Neg", { startingPriceMinor: -1 })).status).toBe("invalid");
    expect(assessPrice(service("o", "One sided", { averagePriceMinor: 500 }))).toMatchObject({ status: "configured", minimum: null, maximum: 500 });
  });

  it("ignores inactive, unknown and duplicate services", () => {
    const result = resolveRecommendations(
      [{ serviceId: "off", isPreferred: true }, { serviceId: "ghost", isPreferred: false }, { serviceId: "on", isPreferred: false }, { serviceId: "on", isPreferred: false }],
      [service("off", "Inactive", { active: false }), service("on", "Active")],
      "ZAR",
    );
    expect(result.map((item) => item.serviceId)).toEqual(["on"]);
  });

  it("returns nothing for an unmapped type", () => {
    expect(resolveRecommendations([], [service("1", "Anything")], "ZAR")).toEqual([]);
  });
});

describe("LEGACY_SERVICE_ALIASES", () => {
  it("covers every opportunity type with unique, lower-case slugs", () => {
    expect(Object.keys(LEGACY_SERVICE_ALIASES).sort()).toEqual([...opportunityTypes].sort());
    const all = Object.values(LEGACY_SERVICE_ALIASES).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const slug of all) expect(slug).toBe(slug.toLowerCase());
  });
});

describe("describeRecommendationPrice", () => {
  it("states a missing price plainly and formats only configured prices", () => {
    expect(describeRecommendationPrice("not_configured", null, null, null)).toBe("Price not configured");
    expect(describeRecommendationPrice("invalid", null, null, null)).toBe("Price unavailable");
    expect(describeRecommendationPrice("configured", 15_000, 25_000, "ZAR")).toMatch(/150.*250/);
    expect(describeRecommendationPrice("configured", 15_000, null, "ZAR")).toMatch(/^From /);
    expect(describeRecommendationPrice("configured", null, 25_000, "ZAR")).toMatch(/^Typical /);
  });
});
