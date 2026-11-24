// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const testEnvironment = {
  AUTH_EMAIL_PROVIDER: "resend" as const,
  RESEND_API_KEY: "re_test_key_long_enough",
  AUTH_EMAIL_FROM: "PRIZM.DEV <onboarding@resend.dev>",
  ADMIN_NOTIFICATION_EMAIL: "owner@example.test",
  AUTH_EMAIL_TEST_MODE: true,
  AUTH_EMAIL_TEST_ALLOWLIST: "owner@example.test",
};

async function setup(environment: Record<string, unknown>) {
  vi.stubEnv("AUTH_EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", String(environment.RESEND_API_KEY));
  vi.doMock("@/config/env", () => ({ getServerEnv: () => environment }));
  const recordAuthSecurityEvent = vi.fn(async () => undefined);
  vi.doMock("./events", () => ({ recordAuthSecurityEvent }));
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ id: "email-id" }), { status: 200 }));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const { getAuthEmailDelivery } = await import("./email-delivery");
  const delivery = getAuthEmailDelivery();
  if (!delivery) throw new Error("Delivery should be configured for this test.");
  return { delivery, fetchMock, recordAuthSecurityEvent };
}

const expiresAt = new Date("2026-11-13T00:00:00Z");

describe("TEST-ONLY email mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sends to the allowlisted owner from the Resend test sender, clearly marked TEST-ONLY, without exposing the key", async () => {
    const { delivery, fetchMock, recordAuthSecurityEvent } = await setup(testEnvironment);
    await delivery.sendVerification({ email: "Owner@Example.Test", name: "Owner", verificationUrl: "https://preview.example.test/verify-email?token=t", expiresAt });

    expect(fetchMock).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ from: "PRIZM.DEV <onboarding@resend.dev>", to: ["Owner@Example.Test"] });
    expect(String(payload.subject).startsWith("[TEST-ONLY] ")).toBe(true);
    expect(String(payload.html)).toContain("TEST-ONLY:");
    expect(String(payload.text).startsWith("TEST-ONLY:")).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(testEnvironment.RESEND_API_KEY);
    expect(recordAuthSecurityEvent).not.toHaveBeenCalled();
  });

  it("blocks verification, password reset and account status emails to any other registered user", async () => {
    const { delivery, fetchMock, recordAuthSecurityEvent } = await setup(testEnvironment);
    const customer = "customer@example.test";
    await expect(delivery.sendVerification({ email: customer, name: "Customer", verificationUrl: "https://preview.example.test/verify-email?token=t", expiresAt })).rejects.toMatchObject({ name: "TestModeRecipientBlockedError" });
    await expect(delivery.sendPasswordReset({ email: customer, name: "Customer", resetUrl: "https://preview.example.test/reset-password?token=t", expiresAt })).rejects.toMatchObject({ name: "TestModeRecipientBlockedError" });
    await expect(delivery.sendAccountStatus({ email: customer, name: "Customer", status: "approved", loginUrl: "https://preview.example.test/login" })).rejects.toMatchObject({ name: "TestModeRecipientBlockedError" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordAuthSecurityEvent).toHaveBeenCalledTimes(3);
    expect(recordAuthSecurityEvent).toHaveBeenCalledWith({ eventType: "email_test_recipient_blocked", outcome: "blocked", identifier: customer });
  });

  it("blocks look-alike and plus-address recipients", async () => {
    const { delivery, fetchMock } = await setup(testEnvironment);
    for (const email of ["owner+extra@example.test", "owner@example.test.evil.com", "xowner@example.test"]) {
      await expect(delivery.sendPasswordReset({ email, name: null, resetUrl: "https://preview.example.test/reset-password?token=t", expiresAt })).rejects.toMatchObject({ name: "TestModeRecipientBlockedError" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the administrator notification only to the allowlisted administrator address, and blocks it otherwise", async () => {
    const allowed = await setup(testEnvironment);
    await allowed.delivery.sendPendingRegistration({ email: "customer@example.test", name: "Customer", adminUrl: "https://preview.example.test/app/admin/users?status=pending" });
    expect(allowed.fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(allowed.fetchMock.mock.calls[0]![1]?.body))).toMatchObject({ to: ["owner@example.test"] });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();

    // Defence in depth: even if environment validation were bypassed, an administrator address outside the allowlist is blocked.
    const blocked = await setup({ ...testEnvironment, ADMIN_NOTIFICATION_EMAIL: "someone-else@example.test" });
    await expect(blocked.delivery.sendPendingRegistration({ email: "customer@example.test", name: "Customer", adminUrl: "https://preview.example.test/app/admin/users" })).rejects.toMatchObject({ name: "TestModeRecipientBlockedError" });
    expect(blocked.fetchMock).not.toHaveBeenCalled();
  });

  it("an empty allowlist sends nothing", async () => {
    const { delivery, fetchMock } = await setup({ ...testEnvironment, AUTH_EMAIL_TEST_ALLOWLIST: "" });
    await expect(delivery.sendVerification({ email: "owner@example.test", name: null, verificationUrl: "https://preview.example.test/verify-email?token=t", expiresAt })).rejects.toMatchObject({ name: "TestModeRecipientBlockedError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves normal delivery untouched when test mode is off (no allowlist, no marking)", async () => {
    const { delivery, fetchMock } = await setup({ ...testEnvironment, AUTH_EMAIL_TEST_MODE: false, AUTH_EMAIL_FROM: "PRIZM.DEV <no-reply@auth.example.test>" });
    await delivery.sendVerification({ email: "customer@example.test", name: "Customer", verificationUrl: "https://app.example.test/verify-email?token=t", expiresAt });
    expect(fetchMock).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({ to: ["customer@example.test"], subject: "Verify your PRIZM.DEV email" });
    expect(String(payload.html)).not.toContain("TEST-ONLY");
  });
});
