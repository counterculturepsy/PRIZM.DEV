// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildCoverNote, getPackTemplate, packTemplateKeys, packTemplates } from "./templates";
import { generateShareToken, hashShareToken, isWellFormedShareToken, shareExpiry } from "./tokens";

describe("application pack templates", () => {
  it("defines the seven required templates with coherent limits", () => {
    expect(packTemplateKeys).toHaveLength(7);
    for (const key of packTemplateKeys) {
      const template = packTemplates[key];
      expect(template.key).toBe(key);
      expect(template.minCaseStudies).toBeLessThanOrEqual(template.maxCaseStudies);
      expect(template.label.length).toBeGreaterThan(5);
    }
    expect(getPackTemplate("senior_developer_application")?.label).toBe("Senior Developer Application");
    expect(getPackTemplate("made_up")).toBeNull();
    expect(getPackTemplate("__proto__")).toBeNull();
  });

  it("builds a cover note only from supplied and selected facts", () => {
    const note = buildCoverNote({
      template: packTemplates.ai_automation_proposal, senderName: "Ada Developer", recipientName: "Sam", recipientOrganisation: "Acme",
      caseStudies: [{ projectName: "Lead triage bot", developmentStatus: "prototype", techStack: ["TypeScript", "OpenAI"] }],
    });
    expect(note).toContain("Hello Sam,");
    expect(note).toContain("your AI and automation project at Acme");
    expect(note).toContain("- Lead triage bot (Prototype; TypeScript, OpenAI)");
    expect(note).not.toMatch(/\d+%|increase|saved|clients|trusted|award|guarantee/i);
    expect(buildCoverNote({ template: packTemplates.partnership_introduction, senderName: "Ada", recipientName: "Sam", purpose: "the platform integration", caseStudies: [] })).toContain("writing about the platform integration.");
  });
});

describe("share tokens", () => {
  it("are unguessable, URL-safe, and only their hash is derivable", () => {
    const token = generateShareToken();
    expect(isWellFormedShareToken(token)).toBe(true);
    expect(generateShareToken()).not.toBe(token);
    expect(hashShareToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token)).toBe(hashShareToken(token));
    expect(hashShareToken(token)).not.toContain(token);
    for (const bad of ["", "short", `${token}x`, `${token.slice(0, 42)}!`, null, undefined, 42]) expect(isWellFormedShareToken(bad)).toBe(false);
  });

  it("bounds the lifetime between one and thirty days", () => {
    const now = new Date("2026-11-17T00:00:00.000Z");
    expect(shareExpiry(7, now).toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(shareExpiry(0, now).toISOString()).toBe("2026-11-18T00:00:00.000Z");
    expect(shareExpiry(365, now).toISOString()).toBe("2026-12-17T00:00:00.000Z");
  });
});
