// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const resendEnvironment = {
  AUTH_EMAIL_PROVIDER: "resend" as const,
  RESEND_API_KEY: "re_test_key_long_enough",
  AUTH_EMAIL_FROM: "PRIZM.DEV <auth@prizm.example>",
  AUTH_EMAIL_REPLY_TO: "support@prizm.example",
  ADMIN_NOTIFICATION_EMAIL: "admin@prizm.example",
};

const brevoEnvironment = {
  AUTH_EMAIL_PROVIDER: "brevo" as const,
  BREVO_API_KEY: "xkeysib-test-key-long-enough",
  AUTH_EMAIL_FROM: "PRIZM.DEV <countercultureliveact@gmail.com>",
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
    vi.stubEnv("AUTH_EMAIL_PROVIDER", resendEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("RESEND_API_KEY", resendEnvironment.RESEND_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => resendEnvironment }));
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
      from: resendEnvironment.AUTH_EMAIL_FROM,
      to: ["new-user@example.test"],
      reply_to: resendEnvironment.AUTH_EMAIL_REPLY_TO,
      subject: "Verify your PRIZM.DEV email",
    });
    expect(String(payload.html)).toContain("PRIZM.DEV");
    expect(String(payload.html)).toContain("HOAX1G.DEV");
    expect(String(payload.html)).toContain("New &lt;User&gt;");
    expect(String(payload.text)).toContain("one-time-token");
    expect(JSON.stringify(payload)).not.toContain(resendEnvironment.RESEND_API_KEY);
  });

  it("routes pending registration alerts only to the configured administrator inbox", async () => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", resendEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("RESEND_API_KEY", resendEnvironment.RESEND_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => resendEnvironment }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    await getAuthEmailDelivery()!.sendPendingRegistration({
      email: "requester@example.test",
      name: "Requester",
      adminUrl: "https://preview.example.test/app/admin/users?status=pending",
    });
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { to: string[]; text: string };
    expect(payload.to).toEqual([resendEnvironment.ADMIN_NOTIFICATION_EMAIL]);
    expect(payload.text).toContain("requester@example.test");
  });

  it("fails closed when Resend rejects a delivery", async () => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", resendEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("RESEND_API_KEY", resendEnvironment.RESEND_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => resendEnvironment }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    await expect(getAuthEmailDelivery()!.sendPasswordReset({
      email: "user@example.test",
      name: null,
      resetUrl: "https://preview.example.test/reset-password?token=one-time-token",
      expiresAt: new Date("2026-11-12T01:00:00Z"),
    })).rejects.toThrow("Transactional email provider rejected the request (403).");
  });

  it("sends Brevo payloads with the verified sender and validates the response", async () => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", brevoEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("BREVO_API_KEY", brevoEnvironment.BREVO_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => brevoEnvironment }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messageId: "<brevo-message-id>" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    await getAuthEmailDelivery()!.sendVerification({
      email: "new-user@example.test",
      name: "Preview User",
      verificationUrl: "https://preview.example.test/verify-email?token=one-time-token",
      expiresAt: new Date("2026-11-13T00:00:00Z"),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(request?.headers).toMatchObject({
      Accept: "application/json",
      "api-key": brevoEnvironment.BREVO_API_KEY,
      "Content-Type": "application/json",
    });
    const payload = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      sender: { name: "PRIZM.DEV", email: "countercultureliveact@gmail.com" },
      to: [{ email: "new-user@example.test" }],
      replyTo: { email: brevoEnvironment.AUTH_EMAIL_REPLY_TO },
      subject: "Verify your PRIZM.DEV email",
    });
    expect(String(payload.htmlContent)).toContain("HOAX1G.DEV");
    expect(String(payload.textContent)).toContain("one-time-token");
    expect(JSON.stringify(payload)).not.toContain(brevoEnvironment.BREVO_API_KEY);
  });

  it("fails closed without falling back when Brevo rejects a delivery", async () => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", brevoEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("BREVO_API_KEY", brevoEnvironment.BREVO_API_KEY);
    vi.stubEnv("RESEND_API_KEY", resendEnvironment.RESEND_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ ...brevoEnvironment, RESEND_API_KEY: resendEnvironment.RESEND_API_KEY }) }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    await expect(getAuthEmailDelivery()!.sendPasswordReset({
      email: "user@example.test",
      name: null,
      resetUrl: "https://preview.example.test/reset-password?token=one-time-token",
      expiresAt: new Date("2026-11-12T01:00:00Z"),
    })).rejects.toThrow("Transactional email provider rejected the request (401).");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("fails closed when Brevo times out", async () => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", brevoEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("BREVO_API_KEY", brevoEnvironment.BREVO_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => brevoEnvironment }));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    await expect(getAuthEmailDelivery()!.sendPasswordReset({
      email: "user@example.test",
      name: null,
      resetUrl: "https://preview.example.test/reset-password?token=one-time-token",
      expiresAt: new Date("2026-11-12T01:00:00Z"),
    })).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("rejects a Brevo success response without a message id", async () => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", brevoEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("BREVO_API_KEY", brevoEnvironment.BREVO_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => brevoEnvironment }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    const { getAuthEmailDelivery } = await import("./email-delivery");
    await expect(getAuthEmailDelivery()!.sendPasswordReset({
      email: "user@example.test",
      name: null,
      resetUrl: "https://preview.example.test/reset-password?token=one-time-token",
      expiresAt: new Date("2026-11-12T01:00:00Z"),
    })).rejects.toThrow("Transactional email provider returned an invalid response.");
  });
});
