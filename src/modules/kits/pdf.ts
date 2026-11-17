import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { developmentStatusLabels, type DevelopmentStatus, type KitContent } from "./content";

export type PdfScreenshot = Readonly<{ bytes: Uint8Array; contentType: "image/png" | "image/jpeg"; caption: string | null }>;

export type PdfCaseStudy = Readonly<{
  projectName: string;
  problem: string;
  solution: string;
  techStack: readonly string[];
  responsibilities: string;
  architectureSummary: string;
  repositoryUrl: string | null;
  demoUrl: string | null;
  results: string | null;
  resultsVerified: boolean;
  developmentStatus: DevelopmentStatus;
  screenshots: readonly PdfScreenshot[];
}>;

export type KitPdfInput = Readonly<{
  content: KitContent;
  caseStudies: readonly PdfCaseStudy[];
  /** Titles of documents provided alongside the kit; the files themselves are never embedded. */
  attachments: readonly { title: string }[];
  /** TrueType bytes for full Latin, Greek and Cyrillic text. Without them the built-in Helvetica is used (WinAnsi only). */
  fonts?: Readonly<{ regular: Uint8Array; bold: Uint8Array }> | undefined;
  meta: Readonly<{ title: string; author: string; subject: string; createdAt: Date; recipientLabel?: string | undefined }>;
}>;

const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = 56;
const FOOTER_SPACE = 40;
const BODY_WIDTH = PAGE.width - MARGIN * 2;
const INK = rgb(0.106, 0.106, 0.169);
const MUTED = rgb(0.357, 0.357, 0.451);
const COVER = rgb(0.043, 0.043, 0.078);
const COVER_TEXT = rgb(0.925, 0.922, 0.961);
const COVER_MUTED = rgb(0.69, 0.686, 0.78);

export function hexToRgb(hex: string) {
  const value = /^#([0-9a-fA-F]{6})$/.exec(hex)?.[1] ?? "8B5CF6";
  return rgb(parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255);
}

/** Splits text into lines that fit `maxWidth`, breaking over-long words by character. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") { lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      candidate = word;
      while (font.widthOfTextAtSize(candidate, size) > maxWidth) {
        let cut = candidate.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(candidate.slice(0, cut), size) > maxWidth) cut -= 1;
        lines.push(candidate.slice(0, cut));
        candidate = candidate.slice(cut);
      }
      line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

/** Replaces any character the font cannot draw with "?", so a stray symbol never aborts the whole document. */
export function replaceUnsupported(value: string, supported: ReadonlySet<number>): string {
  return Array.from(value.normalize("NFKC").replace(/\t/g, " "))
    .map((character) => (character === "\n" || supported.has(character.codePointAt(0) ?? 0) ? character : "?")).join("");
}
export async function generateKitPdf(input: KitPdfInput): Promise<Uint8Array> {
  const { content, meta } = input;
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setCreator("PRIZM.DEV Capability Kit");
  doc.setProducer("PRIZM.DEV");
  doc.setKeywords(["capability kit", ...content.capabilities.flatMap((group) => group.items).slice(0, 8)]);
  doc.setCreationDate(meta.createdAt);
  doc.setModificationDate(meta.createdAt);

  let regular: PDFFont;
  let bold: PDFFont;
  if (input.fonts) {
    doc.registerFontkit(fontkit);
    regular = await doc.embedFont(input.fonts.regular, { subset: true });
    bold = await doc.embedFont(input.fonts.bold, { subset: true });
  } else {
    regular = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  }
  const supported = new Set(regular.getCharacterSet());
  const clean = (value: string) => replaceUnsupported(value, supported);
  const primary = hexToRgb(content.branding.accentPrimary);
  const secondary = hexToRgb(content.branding.accentSecondary);

  // Cover: the dark HOAX1G.DEV identity with restrained violet and cyan accents.
  const cover = doc.addPage([PAGE.width, PAGE.height]);
  cover.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: COVER });
  cover.drawRectangle({ x: MARGIN, y: PAGE.height - 120, width: 56, height: 4, color: primary });
  cover.drawText(clean(content.branding.wordmark), { x: MARGIN, y: PAGE.height - 150, size: 13, font: bold, color: secondary });
  let coverY = PAGE.height - 300;
  for (const line of wrapText(clean(content.profile.displayName), bold, 34, BODY_WIDTH)) {
    cover.drawText(line, { x: MARGIN, y: coverY, size: 34, font: bold, color: COVER_TEXT });
    coverY -= 42;
  }
  for (const line of wrapText(clean(content.profile.headline), regular, 15, BODY_WIDTH)) {
    cover.drawText(line, { x: MARGIN, y: coverY, size: 15, font: regular, color: COVER_MUTED });
    coverY -= 22;
  }
  cover.drawRectangle({ x: MARGIN, y: 150, width: BODY_WIDTH, height: 1, color: primary, opacity: 0.6 });
  cover.drawText("CAPABILITY KIT", { x: MARGIN, y: 120, size: 9, font: bold, color: secondary });
  const prepared = meta.recipientLabel ? `Prepared for ${meta.recipientLabel}` : "Professional capability overview";
  cover.drawText(clean(prepared), { x: MARGIN, y: 100, size: 11, font: regular, color: COVER_MUTED });
  cover.drawText(meta.createdAt.toISOString().slice(0, 10), { x: MARGIN, y: 82, size: 10, font: regular, color: COVER_MUTED });

  let page: PDFPage = cover;
  let y = 0;
  const newPage = () => { page = doc.addPage([PAGE.width, PAGE.height]); y = PAGE.height - MARGIN; };
  const ensure = (height: number) => { if (page === cover || y - height < MARGIN + FOOTER_SPACE) newPage(); };
  const heading = (text: string) => {
    ensure(54);
    y -= 10;
    page.drawRectangle({ x: MARGIN, y: y - 3, width: 4, height: 16, color: primary });
    page.drawText(clean(text), { x: MARGIN + 12, y, size: 15, font: bold, color: INK });
    y -= 26;
  };
  const paragraph = (text: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number } = {}) => {
    const size = options.size ?? 10.5;
    const font = options.font ?? regular;
    const indent = options.indent ?? 0;
    for (const line of wrapText(clean(text), font, size, BODY_WIDTH - indent)) {
      ensure(size * 1.5);
      if (line) page.drawText(line, { x: MARGIN + indent, y, size, font, color: options.color ?? INK });
      y -= size * 1.5;
    }
    y -= 5;
  };
  const labelled = (label: string, value: string) => {
    if (!value.trim()) return;
    ensure(30);
    page.drawText(clean(label.toUpperCase()), { x: MARGIN, y, size: 8, font: bold, color: MUTED });
    y -= 13;
    paragraph(value);
  };

  newPage();
  if (content.introduction) { heading("Introduction"); paragraph(content.introduction); }
  if (content.capabilities.length > 0) {
    heading("Technical capabilities");
    for (const group of content.capabilities) {
      ensure(32);
      page.drawText(clean(group.group), { x: MARGIN, y, size: 10.5, font: bold, color: INK });
      y -= 15;
      paragraph(group.items.join("  ·  "), { color: MUTED });
    }
  }
  if (input.caseStudies.length > 0) {
    heading("Featured projects");
    for (const study of input.caseStudies) {
      ensure(60);
      page.drawText(clean(study.projectName), { x: MARGIN, y, size: 12.5, font: bold, color: INK });
      y -= 16;
      paragraph(`Status: ${developmentStatusLabels[study.developmentStatus]}`, { size: 9, font: bold, color: primary });
      labelled("Problem", study.problem);
      labelled("Solution", study.solution);
      labelled("Technical stack", study.techStack.join(", "));
      labelled("Engineering responsibilities", study.responsibilities);
      labelled("Architecture", study.architectureSummary);
      // Results appear only when the author has marked them verified; the app never invents or infers metrics.
      if (study.resultsVerified && study.results) labelled("Verified results", study.results);
      labelled("Repository", study.repositoryUrl ?? "");
      labelled("Demo", study.demoUrl ?? "");
      for (const shot of study.screenshots.slice(0, 2)) {
        const image = shot.contentType === "image/png" ? await doc.embedPng(shot.bytes) : await doc.embedJpg(shot.bytes);
        const scale = Math.min(BODY_WIDTH / image.width, 220 / image.height, 1);
        ensure(image.height * scale + 24);
        page.drawImage(image, { x: MARGIN, y: y - image.height * scale, width: image.width * scale, height: image.height * scale });
        y -= image.height * scale + 6;
        if (shot.caption) paragraph(shot.caption, { size: 8.5, color: MUTED });
      }
      y -= 8;
    }
  }
  if (content.approach) { heading("Architecture and engineering approach"); paragraph(content.approach); }
  if (content.services.length > 0) { heading("Services and specialties"); for (const service of content.services) paragraph(`•  ${service}`, { indent: 4 }); }
  const contactLines = [content.contact.email && `Email: ${content.contact.email}`, content.contact.website && `Web: ${content.contact.website}`, content.contact.phone && `Phone: ${content.contact.phone}`, content.contact.location && `Location: ${content.contact.location}`].filter((line): line is string => Boolean(line));
  if (contactLines.length > 0) { heading("Contact"); for (const line of contactLines) paragraph(line); }
  if (input.attachments.length > 0) {
    heading("Supporting documents");
    paragraph("Provided separately with this kit:", { color: MUTED });
    for (const attachment of input.attachments) paragraph(`•  ${attachment.title}`, { indent: 4 });
  }

  const pages = doc.getPages();
  pages.slice(1).forEach((current, index) => {
    current.drawRectangle({ x: MARGIN, y: MARGIN + 18, width: BODY_WIDTH, height: 0.5, color: secondary });
    current.drawText(clean(`${content.branding.wordmark}  ·  ${meta.title}`), { x: MARGIN, y: MARGIN, size: 8, font: regular, color: MUTED });
    const label = `Page ${index + 2} of ${pages.length}`;
    current.drawText(label, { x: PAGE.width - MARGIN - regular.widthOfTextAtSize(label, 8), y: MARGIN, size: 8, font: regular, color: MUTED });
  });
  return doc.save();
}
