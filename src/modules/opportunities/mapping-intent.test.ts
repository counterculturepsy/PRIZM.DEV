import { describe, expect, it } from "vitest";
import { parseMappingIntent } from "./mapping-intent";

const id = "5f1c2a52-9a3d-4d2e-8a9b-2b9d6d7e1a10";
const none = () => "";

describe("parseMappingIntent", () => {
  it("parses remove, prefer and clear intents", () => {
    expect(parseMappingIntent(`remove:seo_improvement:${id}`, none)).toEqual({ kind: "remove", opportunityType: "seo_improvement", serviceId: id });
    expect(parseMappingIntent(`prefer:security_hardening:${id}`, none)).toEqual({ kind: "prefer", opportunityType: "security_hardening", serviceId: id });
    expect(parseMappingIntent("clear:mobile_experience", none)).toEqual({ kind: "clear", opportunityType: "mobile_experience" });
  });

  it("reads the service for add from the matching select", () => {
    expect(parseMappingIntent("add:seo_improvement", (name) => (name === "add-seo_improvement" ? id : ""))).toEqual({ kind: "add", opportunityType: "seo_improvement", serviceId: id });
    expect(parseMappingIntent("add:seo_improvement", none)).toBeNull();
  });

  it("rejects unknown types, bad ids, extra segments and unknown actions", () => {
    expect(parseMappingIntent(`remove:not_a_type:${id}`, none)).toBeNull();
    expect(parseMappingIntent("remove:seo_improvement:not-a-uuid", none)).toBeNull();
    expect(parseMappingIntent(`remove:seo_improvement:${id}:extra`, none)).toBeNull();
    expect(parseMappingIntent(`delete:seo_improvement:${id}`, none)).toBeNull();
    expect(parseMappingIntent("clear:seo_improvement:x", none)).toBeNull();
    expect(parseMappingIntent("", none)).toBeNull();
  });
});
