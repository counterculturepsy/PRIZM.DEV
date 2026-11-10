import { describe, expect, it } from "vitest";
import { companyDedupeKey, CsvImportError, MAX_CSV_ROWS, parseCompanyCsv, safeParseCompanyRow } from "./csv";

describe("company CSV parsing", () => {
  it("parses a BOM, normalizes websites, and creates stable domain keys", () => {
    const [row] = parseCompanyCsv("\ufeffname,website,city,country_code\nPrizm Studio,www.example.co.za,Johannesburg,za");
    expect(row).toMatchObject({ name: "Prizm Studio", website: "https://www.example.co.za/", city: "Johannesburg", country_code: "ZA" });
    expect(row && companyDedupeKey(row)).toBe("domain:example.co.za");
  });

  it("rejects unsupported columns and excessive rows", () => {
    expect(() => parseCompanyCsv("name,private_note\nAcme,secret")).toThrow(CsvImportError);
    const rows = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, index) => `Company ${index}`).join("\n");
    expect(() => parseCompanyCsv(`name\n${rows}`)).toThrow(`limited to ${MAX_CSV_ROWS} rows`);
  });

  it("treats a blank country_code cell as missing rather than invalid", () => {
    const rows = parseCompanyCsv("name,country_code\nAcme,\nBeta,za");
    expect(rows.map((row) => row.country_code)).toEqual([undefined, "ZA"]);
    expect(() => parseCompanyCsv("name,country_code\nAcme,zaf")).toThrow("Invalid string");
  });

  it("validates a single provider row with the same rules", () => {
    expect(safeParseCompanyRow({ name: "Acme", website: "acme.example", country_code: "ZA" }).success).toBe(true);
    expect(safeParseCompanyRow({ name: "Acme", email: "nope" }).success).toBe(false);
    expect(safeParseCompanyRow({ name: "Acme", unexpected: "x" }).success).toBe(false);
  });

  it("requires valid public contact fields", () => {
    expect(() => parseCompanyCsv("name,email\nAcme,not-an-email")).toThrow("Invalid email");
    expect(() => parseCompanyCsv("name,source_url\nAcme,javascript:alert(1)")).toThrow("Invalid URL");
  });
});
