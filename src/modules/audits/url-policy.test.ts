import { describe, expect, it } from "vitest";
import { isPrivateAddress, normalizeAuditUrl } from "./url-policy";

describe("website audit URL policy", () => {
  it("normalizes public HTTP URLs and removes fragments", () => {
    expect(normalizeAuditUrl("Example.com/path#private").toString()).toBe("https://example.com/path");
  });

  it.each(["http://localhost", "http://127.0.0.1", "http://10.1.2.3", "http://169.254.169.254/latest", "http://[::1]"])('blocks local destination %s', (value) => {
    expect(() => normalizeAuditUrl(value)).toThrow("Private or local destinations");
  });

  it.each([
    "http://2130706433", "http://0x7f.0.0.1", "http://017700000001", "http://[::ffff:127.0.0.1]", "http://[::ffff:7f00:1]",
    "http://localhost.", "http://service.internal", "http://printer.local", "http://[64:ff9b::7f00:1]", "http://[2001::1]",
    "http://0.0.0.0", "http://100.64.0.1", "http://[fe80::1]", "http://[fd00::1]", "http://192.0.2.10",
  ])("blocks obfuscated or embedded private destination %s", (value) => {
    expect(() => normalizeAuditUrl(value)).toThrow("Private or local destinations");
  });

  it("rejects credentials, non-standard ports and malformed input with specific codes", () => {
    const code = (value: string) => { try { normalizeAuditUrl(value); } catch (error) { return (error as { code?: string }).code; } return "accepted"; };
    expect(code("https://user:pass@example.com")).toBe("url_credentials");
    expect(code("https://example.com:8443/")).toBe("non_standard_port");
    expect(code("http://example.com:80/")).toBe("accepted");
    expect(code("javascript:alert(1)")).toBe("invalid_url");
    expect(code("")).toBe("invalid_url");
  });

  it("treats address families the policy does not know as private", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("64:ff9b::808:808")).toBe(true);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("recognizes representative private and public addresses", () => {
    expect(isPrivateAddress("192.168.1.2")).toBe(true);
    expect(isPrivateAddress("100.64.1.2")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });
});
