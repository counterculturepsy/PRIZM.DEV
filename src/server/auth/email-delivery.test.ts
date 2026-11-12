// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const configuredEnvironment = {
  RESEND_API_KEY: "re_test_key_long_enough",
  AUTH_EMAIL_FROM: "PRIZM.DEV <auth@prizm.example>",
  AUTH_EMAIL_REPLY_TO: "support@prizm.example",
  ADMIN_NOTIFICATION_EMAIL: "admin@prizm.example",
};

describe("transactional authentication email", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("stays disabled when no complete provider configuration exists", async () => {
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({}) }));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    expect(getAuthEmailDelivery()).toBeNull();
  });

  it("sends branded HTML and plain text without exposing the provider key", async () => {
    vi.stubEnv("RESEND_API_KEY", configuredEnvironment.RESEND_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => configuredEnvironment }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "email-id" }), { status: 200 }));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    const delivery = getAuthEmailDelivery();
    expect(delivery).not.toBeNull();
    await delivery!.sendVerification({
      email: "new-user@example.test",
      name: "New <User>",
      verificationUrl: "https://preview.example.test/verify-email?token=one-time-token",
      expiresAt: new Date("2026-11-13T00:00:00Z"),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      from: configuredEnvironment.AUTH_EMAIL_FROM,
      to: ["new-user@example.test"],
      reply_to: configuredEnvironment.AUTH_EMAIL_REPLY_TO,
      subject: "Verify your PRIZM.DEV email",
    });
    expect(String(payload.html)).toContain("PRIZM.DEV");
    expect(String(payload.html)).toContain("HOAX1G.DEV");
    expect(String(payload.html)).toContain("New &lt;User&gt;");
    expect(String(payload.text)).toContain("one-time-token");
    expect(JSON.stringify(payload)).not.toContain(configuredEnvironment.RESEND_API_KEY);
  });

  it("routes pending registration alerts only to the configured administrator inbox", async () => {
    vi.stubEnv("RESEND_API_KEY", configuredEnvironment.RESEND_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => configuredEnvironment }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    await getAuthEmailDelivery()!.sendPendingRegistration({
      email: "requester@example.test",
      name: "Requester",
      adminUrl: "https://preview.example.test/app/admin/users?status=pending",
    });
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { to: string[]; text: string };
    expect(payload.to).toEqual([configuredEnvironment.ADMIN_NOTIFICATION_EMAIL]);
    expect(payload.text).toContain("requester@example.test");
  });

  it("fails closed when Resend rejects a delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", configuredEnvironment.RESEND_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => configuredEnvironment }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    await expect(getAuthEmailDelivery()!.sendPasswordReset({
      email: "user@example.test",
      name: null,
      resetUrl: "https://preview.example.test/reset-password?token=one-time-token",
      expiresAt: new Date("2026-11-12T01:00:00Z"),
    })).rejects.toThrow("Transactional email provider rejected the request (403).");
  });
});
