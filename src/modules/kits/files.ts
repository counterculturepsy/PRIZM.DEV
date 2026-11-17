import { createHash } from "node:crypto";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

export const MAX_PDF_BYTES = 4_000_000;
export const MAX_IMAGE_BYTES = 2_000_000;
export const MAX_PDF_PAGES = 100;
export const MAX_IMAGE_PIXELS = 40_000_000;

export type AssetKind = "pdf" | "image";
export type AssetContentType = "application/pdf" | "image/png" | "image/jpeg";
export type UploadErrorCode =
  | "empty_file" | "unsupported_type" | "type_mismatch" | "file_too_large" | "pdf_invalid" | "pdf_encrypted"
  | "pdf_active_content" | "pdf_too_many_pages" | "image_invalid" | "image_too_large_dimensions";

export class UploadValidationError extends Error {
  constructor(readonly code: UploadErrorCode, message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export type ValidatedUpload = Readonly<{
  kind: AssetKind;
  contentType: AssetContentType;
  filename: string;
  byteSize: number;
  sha256: string;
  pageCount: number | null;
  width: number | null;
  height: number | null;
}>;

const TYPES: Record<AssetContentType, { kind: AssetKind; extension: string }> = {
  "application/pdf": { kind: "pdf", extension: "pdf" },
  "image/png": { kind: "image", extension: "png" },
  "image/jpeg": { kind: "image", extension: "jpg" },
};

/** The file's own bytes decide its type; the browser-supplied type and the extension are never trusted. */
export function detectContentType(bytes: Uint8Array): AssetContentType | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A display-only, path-free name. It is never used to build a storage path. */
export function sanitizeFilename(original: string, extension: string): string {
  const base = (original.normalize("NFKC").split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "");
  let stem = base
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/ {2,}/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^[ .-]+|[ .-]+$/g, "");
  if (!stem || RESERVED_NAMES.test(stem)) stem = "document";
  stem = stem.slice(0, 80).replace(/[ .-]+$/g, "") || "document";
  return `${stem}.${extension}`;
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

// Active or externally-reaching PDF features. Names inside compressed object streams are not visible to this
// scan; the parsed-catalog check below covers the highest-risk entries for those.
const ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|SubmitForm|ImportData|GoToR|GoToE)\b/;

async function validatePdf(bytes: Uint8Array): Promise<{ pageCount: number }> {
  if (!latin1(bytes.subarray(Math.max(0, bytes.length - 1024))).includes("%%EOF")) {
    throw new UploadValidationError("pdf_invalid", "The PDF is incomplete or damaged.");
  }
  if (ACTIVE_CONTENT.test(latin1(bytes))) {
    throw new UploadValidationError("pdf_active_content", "PDFs with scripts, launch actions or embedded files are not accepted.");
  }
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true });
  } catch (error) {
    const encrypted = error instanceof Error && /encrypt/i.test(`${error.name} ${error.message}`);
    throw encrypted
      ? new UploadValidationError("pdf_encrypted", "Password-protected PDFs are not accepted.")
      : new UploadValidationError("pdf_invalid", "The PDF could not be read.");
  }
  let pageCount: number;
  try {
    // A damaged file can parse without a usable catalog; any structural failure here means "not a valid PDF".
    const catalog = document.catalog;
    const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    if (catalog.has(PDFName.of("OpenAction")) || catalog.has(PDFName.of("AA")) || names?.has(PDFName.of("JavaScript"))) {
      throw new UploadValidationError("pdf_active_content", "PDFs with scripts, launch actions or embedded files are not accepted.");
    }
    pageCount = document.getPageCount();
  } catch (error) {
    if (error instanceof UploadValidationError) throw error;
    throw new UploadValidationError("pdf_invalid", "The PDF could not be read.");
  }
  if (pageCount < 1) throw new UploadValidationError("pdf_invalid", "The PDF has no pages.");
  if (pageCount > MAX_PDF_PAGES) throw new UploadValidationError("pdf_too_many_pages", `PDFs are limited to ${MAX_PDF_PAGES} pages.`);
  return { pageCount };
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const end = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  const tail = bytes.subarray(bytes.length - end.length);
  const ihdr = bytes.length >= 24 && latin1(bytes.subarray(12, 16)) === "IHDR";
  if (!ihdr || !end.every((value, index) => tail[index] === value)) throw new UploadValidationError("image_invalid", "The PNG image is incomplete or damaged.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new UploadValidationError("image_invalid", "The JPEG image is incomplete or damaged.");
  let position = 2;
  while (position + 4 < bytes.length) {
    if (bytes[position] !== 0xff) break;
    const marker = bytes[position + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { position += 2; continue; }
    const length = ((bytes[position + 2] ?? 0) << 8) | (bytes[position + 3] ?? 0);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: ((bytes[position + 5] ?? 0) << 8) | (bytes[position + 6] ?? 0), width: ((bytes[position + 7] ?? 0) << 8) | (bytes[position + 8] ?? 0) };
    }
    if (length < 2) break;
    position += 2 + length;
  }
  throw new UploadValidationError("image_invalid", "The JPEG image could not be read.");
}

export async function validateUpload(input: { filename: string; declaredType?: string | undefined; bytes: Uint8Array }): Promise<ValidatedUpload> {
  const { bytes } = input;
  if (bytes.length === 0) throw new UploadValidationError("empty_file", "The file is empty.");
  const contentType = detectContentType(bytes);
  if (!contentType) throw new UploadValidationError("unsupported_type", "Upload a PDF, PNG or JPEG file.");
  if (input.declaredType && input.declaredType !== "application/octet-stream" && input.declaredType !== contentType) {
    throw new UploadValidationError("type_mismatch", "The file content does not match its declared type.");
  }
  const { kind, extension } = TYPES[contentType];
  const limit = kind === "pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (bytes.length > limit) throw new UploadValidationError("file_too_large", `${kind === "pdf" ? "PDFs" : "Images"} are limited to ${(limit / 1_000_000).toFixed(0)} MB.`);

  let pageCount: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if (kind === "pdf") {
    pageCount = (await validatePdf(bytes)).pageCount;
  } else {
    const dimensions = contentType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
    if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
      throw new UploadValidationError("image_too_large_dimensions", "The image dimensions are not supported.");
    }
    ({ width, height } = dimensions);
  }
  return {
    kind, contentType, filename: sanitizeFilename(input.filename, extension), byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), pageCount, width, height,
  };
}
