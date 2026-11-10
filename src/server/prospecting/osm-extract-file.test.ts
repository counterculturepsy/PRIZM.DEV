// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { countLines, streamLines } from "./osm-extract-file";

const directory = mkdtempSync(join(tmpdir(), "prizm-osm-file-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function fileWith(name: string, content: string): string {
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
}

describe("streaming extract files", () => {
  it("delivers every line even when the consumer does other async work before it starts reading", async () => {
    // Regression: a reader created eagerly lost its first lines (26,079 of 26,246 after a 2 ms wait, nothing after 30 ms).
    const path = fileWith("many.txt", `${Array.from({ length: 30_000 }, (_, index) => `line ${index}`).join("\n")}\n`);
    const lines = streamLines(path);
    await wait(30);
    const seen: string[] = [];
    for await (const line of lines) {
      seen.push(line);
      if (seen.length % 10_000 === 0) await wait(5);
    }
    expect(seen).toHaveLength(30_000);
    expect(seen[0]).toBe("line 0");
    expect(seen[29_999]).toBe("line 29999");
  });

  it("counts lines the way they are delivered", async () => {
    expect(await countLines(fileWith("two.txt", "a\nb\n"))).toBe(2);
    expect(await countLines(fileWith("two-unterminated.txt", "a\nb"))).toBe(2);
    expect(await countLines(fileWith("blank-lines.txt", "\n\n"))).toBe(2);
    expect(await countLines(fileWith("crlf.txt", "a\r\nb\r\n"))).toBe(2);
    expect(await countLines(fileWith("empty.txt", ""))).toBe(0);
    for (const name of ["two.txt", "two-unterminated.txt", "blank-lines.txt", "crlf.txt"]) {
      const delivered: string[] = [];
      for await (const line of streamLines(join(directory, name))) delivered.push(line);
      expect(delivered).toHaveLength(await countLines(join(directory, name)));
    }
  });
});
