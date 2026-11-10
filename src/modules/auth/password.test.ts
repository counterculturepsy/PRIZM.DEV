import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("round-trips the right password and rejects the wrong one", async () => {
    const encoded = await hashPassword("SecureAccount123");
    expect(encoded).not.toContain("SecureAccount123");
    await expect(verifyPassword("SecureAccount123", encoded)).resolves.toBe(true);
    await expect(verifyPassword("WrongAccount123", encoded)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    await expect(verifyPassword("SecureAccount123", "not-a-password-hash")).resolves.toBe(false);
  });
});
