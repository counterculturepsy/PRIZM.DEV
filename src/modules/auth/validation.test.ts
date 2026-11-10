import { describe, expect, it } from "vitest";
import { loginSchema, registrationSchema } from "./validation";

describe("authentication validation", () => {
  it("normalizes email addresses", () => {
    expect(loginSchema.parse({ email: "  Owner@Example.COM ", password: "password" }).email).toBe("owner@example.com");
  });

  it("requires a strong bounded registration password", () => {
    const base = { name: "Owner", email: "owner@example.com" };
    expect(registrationSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...base, password: "alllowercase123" }).success).toBe(false);
    expect(registrationSchema.safeParse({ ...base, password: "SecureAccount123" }).success).toBe(true);
    expect(registrationSchema.safeParse({ ...base, password: `A1${"x".repeat(127)}` }).success).toBe(false);
  });
});
