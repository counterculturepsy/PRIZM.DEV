import { readFile } from "node:fs/promises";
import path from "node:path";

export type PdfFonts = Readonly<{ regular: Uint8Array; bold: Uint8Array }>;

// DejaVu Sans (see assets/fonts/DEJAVU-LICENSE.txt): free to redistribute, covers Latin, Latin Extended, Greek and Cyrillic.
const FONT_DIRECTORY = path.join(process.cwd(), "assets", "fonts");
let cached: Promise<PdfFonts | null> | undefined;

/**
 * Loads the bundled fonts once per process. If they cannot be read the PDF falls back to built-in Helvetica (WinAnsi
 * only) rather than failing, and one warning is logged. No document content or path is logged.
 */
export function loadPdfFonts(): Promise<PdfFonts | null> {
  cached ??= (async () => {
    try {
      const [regular, bold] = await Promise.all([
        readFile(path.join(FONT_DIRECTORY, "DejaVuSans.ttf")),
        readFile(path.join(FONT_DIRECTORY, "DejaVuSans-Bold.ttf")),
      ]);
      return { regular: new Uint8Array(regular), bold: new Uint8Array(bold) };
    } catch {
      console.warn("kit_pdf_fonts_unavailable: falling back to Helvetica");
      return null;
    }
  })();
  return cached;
}
