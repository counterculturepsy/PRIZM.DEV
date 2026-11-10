import { describe, expect, it } from "vitest";
import { analyzeWebsiteSnapshot } from "./analyzer";
import type { AuditSnapshot } from "./types";

function snapshot(html: string, overrides: Partial<AuditSnapshot> = {}): AuditSnapshot {
  return {
    requestedUrl: "https://example.com/", finalUrl: "https://example.com/", status: 200,
    contentType: "text/html; charset=utf-8", headers: {
      "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    }, body: Buffer.from(html), responseBytes: Buffer.byteLength(html), durationMs: 120,
    observedAt: new Date("2026-10-15T00:00:00Z"), robotsAllowed: true, ...overrides,
  };
}

describe("static website analyzer", () => {
  it("returns a clean versioned diagnostic for a well-formed static document", () => {
    const result = analyzeWebsiteSnapshot(snapshot('<!doctype html><html lang="en"><head><title>Example Company Digital Services</title><meta name="description" content="A useful description"><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/"></head><body><h1>Example</h1><img alt="Team" src="team.jpg"><label for="email">Email</label><input id="email"></body></html>'));
    expect(result.score).toBe(100);
    expect(result.findings).toHaveLength(0);
  });

  it("does not report buttons, submit inputs or named image inputs as unlabelled controls", () => {
    const flagged = (body: string) => analyzeWebsiteSnapshot(snapshot(`<html lang="en"><body>${body}</body></html>`)).findings.map((item) => item.code).includes("a11y.form_label_missing");
    expect(flagged('<form><input type="submit" value="Send"><input type="reset"><input type="button" value="Go"><input type="image" alt="Search" src="s.png"></form>')).toBe(false);
    expect(flagged('<input type="hidden" name="token"><input aria-label="Search"><label>Name <input></label>')).toBe(false);
    expect(flagged('<input type="button">')).toBe(true);
    expect(flagged('<input type="image" src="s.png">')).toBe(true);
    expect(flagged('<input type="text">')).toBe(true);
    expect(flagged("<select></select>")).toBe(true);
  });

  it("records concrete evidence and bounded score impacts", () => {
    const result = analyzeWebsiteSnapshot(snapshot("<html><body><img src='missing.jpg'><input></body></html>", { headers: {}, durationMs: 4_000 }));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining(["seo.title_missing", "a11y.lang_missing", "a11y.image_alt_missing", "a11y.form_label_missing", "security.csp_missing"]));
    expect(result.findings.find((item) => item.code === "a11y.image_alt_missing")?.evidence).toContain("1 images");
  });
});
