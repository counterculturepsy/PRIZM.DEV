// @vitest-environment node

import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { detectContentType, MAX_PDF_BYTES, sanitizeFilename, UploadValidationError, validateUpload } from "./files";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

async function pdf(pages = 1, options: { objectStreams?: boolean; openAction?: boolean } = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pages; index += 1) document.addPage([300, 300]);
  if (options.openAction) {
    document.catalog.set(PDFName.of("OpenAction"), document.context.obj({ S: "JavaScript", JS: PDFString.of("app.alert(1)") }));
  }
  return document.save({ useObjectStreams: options.objectStreams ?? false });
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { return error instanceof UploadValidationError ? error.code : `unexpected:${String(error)}`; }
  return "accepted";
}

describe("upload validation", () => {
  it("accepts a real PDF, PNG and JPEG and reports their metadata from the bytes", async () => {
    const accepted = await validateUpload({ filename: "../CV final.pdf", declaredType: "application/pdf", bytes: await pdf(3) });
    expect(accepted).toMatchObject({ kind: "pdf", contentType: "application/pdf", pageCount: 3, filename: "CV final.pdf" });
    expect(accepted.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await validateUpload({ filename: "shot.PNG", declaredType: "image/png", bytes: PNG_1X1 })).toMatchObject({ kind: "image", contentType: "image/png", width: 1, height: 1, filename: "shot.png" });
    expect(await validateUpload({ filename: "photo.jpeg", bytes: jpeg(640, 480) })).toMatchObject({ contentType: "image/jpeg", width: 640, height: 480, filename: "photo.jpg" });
  });

  it("decides the type from the content, never the name or the declared type", async () => {
    const exe = Buffer.from("MZ\x90\x00 this is not a pdf");
    expect(await rejection(validateUpload({ filename: "resume.pdf", declaredType: "application/pdf", bytes: exe }))).toBe("unsupported_type");
    expect(await rejection(validateUpload({ filename: "notes.txt", bytes: Buffer.from("plain text") }))).toBe("unsupported_type");
    expect(await rejection(validateUpload({ filename: "x.png", declaredType: "image/png", bytes: await pdf() }))).toBe("type_mismatch");
    expect(await rejection(validateUpload({ filename: "x.pdf", bytes: new Uint8Array() }))).toBe("empty_file");
    expect(detectContentType(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(detectContentType(Buffer.from("<html>"))).toBeNull();
  });

  it("enforces size limits, completeness and page limits", async () => {
    const huge = new Uint8Array(MAX_PDF_BYTES + 1);
    huge.set(Buffer.from("%PDF-1.7"));
    expect(await rejection(validateUpload({ filename: "big.pdf", bytes: huge }))).toBe("file_too_large");
    const valid = await pdf();
    expect(await rejection(validateUpload({ filename: "cut.pdf", bytes: valid.subarray(0, valid.length - 1200 > 0 ? valid.length - 1200 : 10) }))).toBe("pdf_invalid");
    expect(await rejection(validateUpload({ filename: "garbage.pdf", bytes: Buffer.from("%PDF-1.7\nnot really\n%%EOF") }))).toBe("pdf_invalid");
    expect(await rejection(validateUpload({ filename: "many.pdf", bytes: await pdf(101) }))).toBe("pdf_too_many_pages");
    expect(await rejection(validateUpload({ filename: "pixels.jpg", bytes: jpeg(20_000, 20_000) }))).toBe("image_too_large_dimensions");
    expect(await rejection(validateUpload({ filename: "cut.png", bytes: PNG_1X1.subarray(0, PNG_1X1.length - 4) }))).toBe("image_invalid");
  });

  it("rejects PDFs that carry scripts, whether or not their objects are compressed", async () => {
    expect(await rejection(validateUpload({ filename: "plain.pdf", bytes: await pdf(1, { openAction: true }) }))).toBe("pdf_active_content");
    expect(await rejection(validateUpload({ filename: "packed.pdf", bytes: await pdf(1, { openAction: true, objectStreams: true }) }))).toBe("pdf_active_content");
  });
});

/** A structurally valid PDF whose trailer declares standard-handler encryption, with correct cross-reference offsets. */
function encryptedPdf(): Uint8Array {
  const zeros = "00".repeat(32);
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>\nendobj\n",
    `4 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <${zeros}> /U <${zeros}> /P -4 >>\nendobj\n`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) { offsets.push(body.length); body += object; }
  const xref = body.length;
  body += `xref\n0 5\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${"11".repeat(16)}> <${"11".repeat(16)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

describe("encrypted PDFs", () => {
  it("are refused with a specific reason, while the same structure without encryption is accepted", async () => {
    expect(await rejection(validateUpload({ filename: "locked.pdf", declaredType: "application/pdf", bytes: encryptedPdf() }))).toBe("pdf_encrypted");
    const plain = Buffer.from(Buffer.from(encryptedPdf()).toString("latin1").replace("/Encrypt 4 0 R ", ""), "latin1");
    // Removing the trailer entry shifts nothing before the xref, so this is a valid unencrypted PDF.
    expect(await rejection(validateUpload({ filename: "open.pdf", declaredType: "application/pdf", bytes: plain }))).toBe("accepted");
  });
});
describe("filename sanitising", () => {
  it("never keeps a path, control characters, reserved names or a hidden-file prefix", () => {
    expect(sanitizeFilename("../../etc/passwd", "pdf")).toBe("passwd.pdf");
    expect(sanitizeFilename("C:\\Users\\me\\CV (final).pdf", "pdf")).toBe("CV -final.pdf");
    expect(sanitizeFilename("CON.pdf", "pdf")).toBe("document.pdf");
    expect(sanitizeFilename(".htaccess", "pdf")).toBe("document.pdf");
    expect(sanitizeFilename("..", "pdf")).toBe("document.pdf");
    expect(sanitizeFilename("", "png")).toBe("document.png");
    expect(sanitizeFilename("invoice\u0000\u202egnp.exe", "pdf")).toBe("invoice-gnp.pdf");
    expect(sanitizeFilename("a".repeat(500), "pdf").length).toBeLessThanOrEqual(84);
    expect(sanitizeFilename("résumé 日本語.pdf", "pdf")).toMatch(/^[A-Za-z0-9._ -]+\.pdf$/);
  });
});
