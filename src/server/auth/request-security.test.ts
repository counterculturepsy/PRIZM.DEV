import { describe, expect, it } from "vitest";
import { assertTrustedMutationOrigin, trustedClientIp, UntrustedMutationOriginError } from "./request-security";

describe("authentication request security", () => {
  it("accepts only the configured mutation origin", () => {
    const request = new Request("https://app.example.test/api/auth/register", { headers: { origin: "https://app.example.test" } });
    expect(() => assertTrustedMutationOrigin(request, "https://app.example.test")).not.toThrow();
    for (const origin of [undefined, "null", "https://evil.example", "not-a-url"]) {
      const init = origin ? { headers: { origin } } : {};
      expect(() => assertTrustedMutationOrigin(new Request("https://app.example.test/api", init), "https://app.example.test"))
        .toThrow(UntrustedMutationOriginError);
    }
  });

  it("ignores spoofable forwarded headers outside Vercel", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10",
      "x-real-ip": "203.0.113.11",
      "x-vercel-forwarded-for": "203.0.113.12",
    });
    expect(trustedClientIp(headers, { isVercel: false })).toBeNull();
  });

  it("accepts only one valid Vercel-supplied client address", () => {
    expect(trustedClientIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.12" }), { isVercel: true })).toBe("203.0.113.12");
    expect(trustedClientIp(new Headers({ "x-vercel-forwarded-for": "2001:db8::1" }), { isVercel: true })).toBe("2001:db8::1");
    expect(trustedClientIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.12, 10.0.0.1" }), { isVercel: true })).toBeNull();
    expect(trustedClientIp(new Headers({ "x-vercel-forwarded-for": "not-an-ip" }), { isVercel: true })).toBeNull();
  });
});
