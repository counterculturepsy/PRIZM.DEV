// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { emptyKitContent, kitContentSchema } from "./content";
import { generateKitPdf, hexToRgb, replaceUnsupported, wrapText, type PdfCaseStudy } from "./pdf";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const createdAt = new Date("2026-11-17T08:00:00.000Z");

/** Pulls the drawn text back out of a generated PDF: inflate each stream, then read the hex strings passed to Tj. */
function extractText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const out: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = buffer.indexOf("stream", cursor, "latin1");
    if (start < 0) break;
    const dataStart = buffer[start + 6] === 0x0d ? start + 8 : start + 7;
    const end = buffer.indexOf("endstream", dataStart, "latin1");
    if (end < 0) break;
    cursor = end + 9;
    let text: string;
    try { text = inflateSync(buffer.subarray(dataStart, end)).toString("latin1"); } catch { continue; }
    for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      out.push(Buffer.from(match[1] ?? "", "hex").toString("latin1"));
    }
  }
  return out.join("\n");
}

const study = (overrides: Partial<PdfCaseStudy> = {}): PdfCaseStudy => ({
  projectName: "Tenant-isolated CRM", problem: "Agencies lost track of leads.", solution: "A multi-tenant CRM with audited pipeline.",
  techStack: ["Next.js", "PostgreSQL", "TypeScript"], responsibilities: "Schema, authorization and delivery.", architectureSummary: "Workspace-scoped composite keys.",
  repositoryUrl: "https://github.com/example/crm", demoUrl: null, results: "Cut triage time by 40%.", resultsVerified: false,
  developmentStatus: "in_development", screenshots: [], ...overrides,
});

const content = kitContentSchema.parse({
  profile: { displayName: "Ada Developer", headline: "Full-stack engineer" },
  introduction: "I build secure SaaS products.",
  capabilities: [{ group: "Backend", items: ["Node.js", "PostgreSQL"] }],
  approach: "Small, tested changes.", services: ["Web applications"],
  contact: { email: "ada@example.com", website: "https://example.com" },
});

describe("capability kit PDF", () => {
  it("produces a valid A4 document with metadata, a branded cover and numbered footers", async () => {
    const bytes = await generateKitPdf({ content, caseStudies: [study()], attachments: [{ title: "Reference letter" }], meta: { title: "Ada Developer capability kit", author: "Ada Developer", subject: "Capability kit", createdAt, recipientLabel: "Acme Ltd" } });
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getTitle()).toBe("Ada Developer capability kit");
    expect(loaded.getAuthor()).toBe("Ada Developer");
    expect(loaded.getCreator()).toBe("PRIZM.DEV Capability Kit");
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(loaded.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
    const text = extractText(bytes);
    expect(text).toContain("Ada Developer");
    expect(text).toContain("Prepared for Acme Ltd");
    expect(text).toContain("Tenant-isolated CRM");
    expect(text).toContain("Status: In development");
    expect(text).toContain("Reference letter");
    expect(text).toMatch(/Page 2 of \d+/);
  });

  it("shows results only when the author marked them verified, and never invents any", async () => {
    const unverified = extractText(await generateKitPdf({ content, caseStudies: [study()], attachments: [], meta: { title: "t", author: "a", subject: "s", createdAt } }));
    expect(unverified).not.toContain("Cut triage time");
    expect(unverified).not.toContain("VERIFIED RESULTS");
    const verified = extractText(await generateKitPdf({ content, caseStudies: [study({ resultsVerified: true })], attachments: [], meta: { title: "t", author: "a", subject: "s", createdAt } }));
    expect(verified).toContain("Cut triage time by 40%.");
    const noResults = extractText(await generateKitPdf({ content, caseStudies: [study({ resultsVerified: true, results: null })], attachments: [], meta: { title: "t", author: "a", subject: "s", createdAt } }));
    expect(noResults).not.toContain("VERIFIED RESULTS");
  });

  it("is deterministic for identical input and paginates long content without losing text", async () => {
    const input = { content, caseStudies: [study()], attachments: [], meta: { title: "t", author: "a", subject: "s", createdAt } } as const;
    const first = await generateKitPdf(input);
    const second = await generateKitPdf(input);
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0);
    const long = kitContentSchema.parse({ ...content, introduction: "Sentence about engineering. ".repeat(70), approach: "Another long approach sentence. ".repeat(70) });
    const many = Array.from({ length: 5 }, (_, index) => study({ projectName: `Project ${index + 1}`, problem: "Problem statement. ".repeat(60) }));
    const bytes = await generateKitPdf({ ...input, content: long, caseStudies: many });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(3);
    const text = extractText(bytes);
    for (let index = 1; index <= 5; index += 1) expect(text).toContain(`Project ${index}`);
  });

  it("embeds screenshots and survives characters Helvetica cannot encode", async () => {
    const bytes = await generateKitPdf({
      content: kitContentSchema.parse({ ...content, profile: { displayName: "Zoë 日本 Developer 🚀" } }),
      caseStudies: [study({ screenshots: [{ bytes: PNG_1X1, contentType: "image/png", caption: "Dashboard" }] })],
      attachments: [], meta: { title: "t", author: "a", subject: "s", createdAt },
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
    expect(extractText(bytes)).toContain("Dashboard");
  });
});

describe("pdf helpers and content schema", () => {
  it("wraps text to the width and breaks over-long words", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont("Helvetica");
    const lines = wrapText("alpha beta gamma delta ".repeat(10), font, 10, 120);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((line) => font.widthOfTextAtSize(line, 10) <= 120)).toBe(true);
    const broken = wrapText("x".repeat(200), font, 10, 100);
    expect(broken.length).toBeGreaterThan(1);
    expect(broken.join("")).toBe("x".repeat(200));
    expect(wrapText("one\n\ntwo", font, 10, 100)).toEqual(["one", "", "two"]);
  });

  it("validates branding, links and structure", () => {
    expect(hexToRgb("#22D3EE")).toMatchObject({ red: expect.closeTo(0.133, 2) });
    expect(emptyKitContent("Ada").branding).toEqual({ wordmark: "HOAX1G.DEV", accentPrimary: "#8B5CF6", accentSecondary: "#22D3EE" });
    expect(kitContentSchema.safeParse({ profile: { displayName: "A" } }).success).toBe(false);
    expect(kitContentSchema.safeParse({ profile: { displayName: "Ada" }, branding: { accentPrimary: "violet" } }).success).toBe(false);
    expect(kitContentSchema.safeParse({ profile: { displayName: "Ada" }, contact: { website: "http://insecure.example" } }).success).toBe(false);
    expect(kitContentSchema.safeParse({ profile: { displayName: "Ada" }, contact: { website: "javascript:alert(1)" } }).success).toBe(false);
    expect(kitContentSchema.safeParse({ profile: { displayName: "Ada" }, featuredCaseStudyIds: ["not-a-uuid"] }).success).toBe(false);
  });
});

describe("unicode support", () => {
  const fontDirectory = path.join(process.cwd(), "assets", "fonts");
  const fonts = { regular: readFileSync(path.join(fontDirectory, "DejaVuSans.ttf")), bold: readFileSync(path.join(fontDirectory, "DejaVuSans-Bold.ttf")) };
  const sample = "Zoë Łukasz Привет Ελληνικά Ñandú";

  async function characterSet(bytes: Uint8Array | "helvetica") {
    const document = await PDFDocument.create();
    if (bytes === "helvetica") return new Set((await document.embedFont("Helvetica")).getCharacterSet());
    document.registerFontkit(fontkit);
    return new Set((await document.embedFont(bytes)).getCharacterSet());
  }

  it("keeps Latin Extended, Greek and Cyrillic text with the bundled font, where Helvetica would print question marks", async () => {
    const dejavu = await characterSet(fonts.regular);
    expect(replaceUnsupported(sample, dejavu)).toBe(sample);
    const helvetica = await characterSet("helvetica");
    expect(replaceUnsupported("Привет Ελληνικά", helvetica)).toBe("?????? ????????");
    // Genuinely unsupported scripts and emoji still degrade to a visible placeholder instead of aborting the document.
    expect(replaceUnsupported("日本 🚀", dejavu)).toBe("?? ?");
  });

  it("embeds the Unicode font as a subset and produces a valid, deterministic PDF", async () => {
    const input = {
      content: kitContentSchema.parse({ profile: { displayName: "Łukasz Привет", headline: sample }, introduction: sample }),
      caseStudies: [study({ projectName: "Ελληνικά project" })], attachments: [], fonts,
      meta: { title: "Unicode kit", author: "Łukasz", subject: "s", createdAt },
    } as const;
    const first = await generateKitPdf(input);
    const second = await generateKitPdf(input);
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0);
    const loaded = await PDFDocument.load(first);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(allText(first)).toContain("DejaVuSans");
    // A subset, not the whole 750 KB font.
    expect(first.length).toBeLessThan(200_000);
    const withoutFonts = await generateKitPdf({ ...input, fonts: undefined });
    expect(allText(withoutFonts)).not.toContain("DejaVuSans");
  });
});

/** Everything searchable in a PDF: the raw bytes plus every inflated stream (object streams hold the font dictionaries). */
function allText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const parts = [buffer.toString("latin1")];
  let cursor = 0;
  for (;;) {
    const start = buffer.indexOf("stream", cursor, "latin1");
    if (start < 0) break;
    const dataStart = buffer[start + 6] === 0x0d ? start + 8 : start + 7;
    const end = buffer.indexOf("endstream", dataStart, "latin1");
    if (end < 0) break;
    cursor = end + 9;
    try { parts.push(inflateSync(buffer.subarray(dataStart, end)).toString("latin1")); } catch { /* not a Flate stream */ }
  }
  return parts.join("\n");
}