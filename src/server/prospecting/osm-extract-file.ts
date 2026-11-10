import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Streams a text file line by line. The reader is created only when iteration starts. Creating it earlier loses lines:
 * a readline interface starts emitting immediately, so any await between creating it and iterating it (for example a
 * database insert) discards the lines emitted in the meantime.
 */
export async function* streamLines(path: string): AsyncGenerator<string> {
  const reader = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  try {
    for await (const line of reader) yield line;
  } finally {
    reader.close();
  }
}

/** Counts lines the way readline delivers them: one per line break, plus a final line without a break. */
export async function countLines(path: string): Promise<number> {
  let breaks = 0;
  let lastByte = 10;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    for (const byte of bytes) if (byte === 10) breaks += 1;
    if (bytes.length > 0) lastByte = bytes[bytes.length - 1] ?? lastByte;
  }
  return lastByte === 10 ? breaks : breaks + 1;
}
