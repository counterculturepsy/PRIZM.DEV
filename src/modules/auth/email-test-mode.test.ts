import { describe, expect, it } from "vitest";
import {
  TEST_ONLY_SUBJECT_PREFIX,
  TestModeRecipientBlockedError,
  addressOf,
  guardTestRecipient,
  isAllowlisted,
  isSenderOnTestDomain,
  markTestMessage,
  parseTestAllowlist,
} from "./email-test-mode";

describe("addressOf", () => {
  it("reads bare and display-name addresses and normalises case", () => {
    expect(addressOf("Owner@Example.TEST")).toBe("owner@example.test");
    expect(addressOf("PRIZM.DEV <onboarding@resend.dev>")).toBe("onboarding@resend.dev");
    expect(addressOf("not an address")).toBeNull();
    expect(addressOf("")).toBeNull();
    expect(addressOf(undefined)).toBeNull();
  });
});

describe("parseTestAllowlist", () => {
  it("splits on commas, semicolons and whitespace, lower-cases and removes duplicates", () => {
    expect(parseTestAllowlist("Owner@example.test, owner@example.test; second@example.test\nthird@example.test")).toEqual([
      "owner@example.test",
      "second@example.test",
      "third@example.test",
    ]);
    expect(parseTestAllowlist("")).toEqual([]);
    expect(parseTestAllowlist(undefined)).toEqual([]);
  });
});

describe("recipient allowlist", () => {
  const allowlist = parseTestAllowlist("owner@example.test");

  it("allows only an exact, case-insensitive match", () => {
    expect(isAllowlisted(allowlist, "owner@example.test")).toBe(true);
    expect(isAllowlisted(allowlist, "OWNER@Example.Test")).toBe(true);
    expect(isAllowlisted(allowlist, "Owner <owner@example.test>")).toBe(true);
  });

  it("rejects other users, look-alikes, plus-addresses, other domains and empty values", () => {
    for (const recipient of ["customer@example.test", "owner+tag@example.test", "owner@example.test.evil.com", "xowner@example.test", "@example.test", "", "owner"]) {
      expect(isAllowlisted(allowlist, recipient), recipient).toBe(false);
    }
  });

  it("throws a typed error for a blocked recipient and nothing for an allowed one", () => {
    expect(() => guardTestRecipient(allowlist, "owner@example.test")).not.toThrow();
    expect(() => guardTestRecipient(allowlist, "customer@example.test")).toThrow(TestModeRecipientBlockedError);
  });

  it("an empty allowlist allows nobody", () => {
    expect(isAllowlisted([], "owner@example.test")).toBe(false);
  });
});

describe("isSenderOnTestDomain", () => {
  it("recognises only the resend.dev test sender", () => {
    expect(isSenderOnTestDomain("PRIZM.DEV <onboarding@resend.dev>")).toBe(true);
    expect(isSenderOnTestDomain("onboarding@resend.dev")).toBe(true);
    expect(isSenderOnTestDomain("PRIZM.DEV <no-reply@auth.hoax1g.dev>")).toBe(false);
    expect(isSenderOnTestDomain("onboarding@resend.dev.evil.com")).toBe(false);
    expect(isSenderOnTestDomain(undefined)).toBe(false);
  });
});

describe("markTestMessage", () => {
  it("prefixes the subject and adds an unmistakable banner to both parts", () => {
    const marked = markTestMessage({ subject: "Verify your email", html: "<html><body><p>Hello</p></body></html>", text: "Hello" });
    expect(marked.subject).toBe(`${TEST_ONLY_SUBJECT_PREFIX}Verify your email`);
    expect(marked.subject.startsWith("[TEST-ONLY]")).toBe(true);
    expect(marked.html).toMatch(/<body[^>]*><p [^>]*>TEST-ONLY:/);
    expect(marked.html).toContain("<p>Hello</p>");
    expect(marked.text.startsWith("TEST-ONLY:")).toBe(true);
    expect(marked.text).toContain("Hello");
  });

  it("adds the banner even when the HTML has no body tag", () => {
    expect(markTestMessage({ subject: "s", html: "<p>x</p>", text: "x" }).html.startsWith("<p style=")).toBe(true);
  });
});
