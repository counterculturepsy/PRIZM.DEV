import { describe, expect, it } from "vitest";
import { inviteMemberSchema, normalizeFeatures, onboardingSchema, parseFeatureLines, serviceDetailsSchema, toSlug } from "./validation";

describe("workspace validation", () => {
  it("creates stable URL-safe slugs", () => {
    expect(toSlug("  Cape & Code Studio  ")).toBe("cape-code-studio");
  });

  it("does not allow another owner to be invited", () => {
    expect(inviteMemberSchema.safeParse({ email: "owner@example.com", role: "owner" }).success).toBe(false);
  });

  it("rejects inverted budgets", () => {
    const result = onboardingSchema.safeParse({
      services: "Web design",
      cities: "Cape Town",
      industries: "Hospitality",
      minimumBudget: 50_000,
      maximumBudget: 10_000,
    });
    expect(result.success).toBe(false);
  });
});

describe("service details validation", () => {
  const serviceId = "5f1c2a52-9a3d-4d2e-8a9b-2b9d6d7e1a10";
  const parse = (input: Record<string, unknown>) => serviceDetailsSchema.safeParse({ serviceId, description: "", features: [], ...input });

  it("accepts a description of exactly 500 characters and rejects 501", () => {
    expect(parse({ description: "d".repeat(500) }).success).toBe(true);
    const tooLong = parse({ description: "d".repeat(501) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toMatch(/500 characters/);
  });

  it("trims the description and allows it to be cleared", () => {
    expect(parse({ description: "  Text  " }).data?.description).toBe("Text");
    expect(parse({ description: "   " }).data?.description).toBe("");
  });

  it("accepts 12 features of 80 characters and rejects 13 or an 81-character feature", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => String.fromCharCode(97 + index).repeat(80));
    expect(parse({ features: twelve }).data?.features).toHaveLength(12);
    const thirteen = Array.from({ length: 13 }, (_, index) => "Feature " + String(index));
    expect(parse({ features: thirteen }).error?.issues[0]?.message).toMatch(/at most 12/);
    expect(parse({ features: ["y".repeat(81)] }).error?.issues[0]?.message).toMatch(/80 characters/);
  });

  it("drops blanks and exact duplicates before counting, so 13 lines with repeats can still fit", () => {
    const input = ["A", "", "A", "B", " B ", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
    expect(parse({ features: input }).data?.features).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);
  });

  it("parses one feature per line, handling Windows line endings", () => {
    expect(parseFeatureLines("One\r\n  Two  \n\nOne\nThree")).toEqual(["One", "Two", "Three"]);
    expect(parseFeatureLines("")).toEqual([]);
    expect(normalizeFeatures(["  x  ", "x", ""])).toEqual(["x"]);
  });

  it("rejects a bad service id and non-list features", () => {
    expect(parse({ serviceId: "nope" }).success).toBe(false);
    expect(parse({ features: "a list please" }).success).toBe(false);
  });

  it("carries no field other than service id, description and features", () => {
    const result = parse({ name: "Hacked", slug: "hacked", active: false, startingPriceMinor: 1, deliveryTimeDays: 3 });
    expect(Object.keys(result.data ?? {}).sort()).toEqual(["description", "features", "serviceId"]);
  });
});
