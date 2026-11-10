import { describe, expect, it } from "vitest";
import { isRobotsAllowed } from "./robots";

describe("robots policy", () => {
  it("uses the specific product group ahead of wildcard rules", () => {
    const text = "User-agent: *\nDisallow: /\n\nUser-agent: PRIZMDEV\nAllow: /public\nDisallow: /private";
    expect(isRobotsAllowed(text, new URL("https://example.com/public"))).toBe(true);
    expect(isRobotsAllowed(text, new URL("https://example.com/private"))).toBe(false);
  });

  it("uses the longest matching rule and allow wins an equal tie", () => {
    const text = "User-agent: *\nDisallow: /catalog\nAllow: /catalog/public\nDisallow: /file$\nAllow: /file-long";
    expect(isRobotsAllowed(text, new URL("https://example.com/catalog/public/item"))).toBe(true);
    expect(isRobotsAllowed(text, new URL("https://example.com/catalog/hidden"))).toBe(false);
    expect(isRobotsAllowed(text, new URL("https://example.com/file"))).toBe(false);
    expect(isRobotsAllowed(text, new URL("https://example.com/file-long"))).toBe(true);
  });

  it("matches wildcard and end-anchored patterns like the robots standard", () => {
    const text = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /search*?q=\nDisallow: */admin\nDisallow: /a*b*c\nDisallow: /exact$";
    const allowed = (path: string) => isRobotsAllowed(text, new URL(`https://example.com${path}`));
    expect(allowed("/files/report.pdf")).toBe(false);
    expect(allowed("/files/report.pdf?download=1")).toBe(true);
    expect(allowed("/files/report.pdfx")).toBe(true);
    expect(allowed("/search/results?q=shoes")).toBe(false);
    expect(allowed("/search/results")).toBe(true);
    expect(allowed("/x/admin")).toBe(false);
    expect(allowed("/aXXbYYc")).toBe(false);
    expect(allowed("/aXXcYYb")).toBe(true);
    expect(allowed("/exact")).toBe(false);
    expect(allowed("/exact/more")).toBe(true);
  });

  it("agrees with a reference regular-expression matcher on generated patterns", () => {
    const reference = (path: string, pattern: string) => {
      const anchored = pattern.endsWith("$");
      const source = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
    };
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const alphabet = ["a", "b", "c", "-"];
    const word = (max: number) => Array.from({ length: 1 + Math.floor(next() * max) }, () => alphabet[Math.floor(next() * alphabet.length)]).join("");
    for (let index = 0; index < 3000; index += 1) {
      let pattern = `/${word(3)}`;
      for (let part = Math.floor(next() * 4); part > 0; part -= 1) pattern += `*${word(2)}`;
      if (next() < 0.3) pattern += "*";
      if (next() < 0.3) pattern += "$";
      const path = `/${word(10)}`;
      expect(isRobotsAllowed(`User-agent: *\nDisallow: ${pattern}`, new URL(`https://example.com${path}`)), `${pattern} vs ${path}`).toBe(!reference(path, pattern));
    }
  });

  it("stays fast on hostile wildcard patterns", () => {
    const started = performance.now();
    expect(isRobotsAllowed(`User-agent: *\nDisallow: /${"a*".repeat(60)}b`, new URL(`https://example.com/${"a".repeat(400)}`))).toBe(true);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
