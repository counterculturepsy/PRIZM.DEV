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
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => undefined);
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
    expect(infoLog).toHaveBeenCalledWith("auth_email_delivery_accepted", {
      provider: "resend",
      httpStatus: 200,
      messageIdPresent: true,
    });
    expect(JSON.stringify(infoLog.mock.calls)).not.toContain("email-id");
  });

  it("routes pending registration alerts only to the configured administrator inbox", async () => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", resendEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("RESEND_API_KEY", resendEnvironment.RESEND_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => resendEnvironment }));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "admin-email-id" }), { status: 200 }));
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

  it("does not fall back to Brevo when Resend rejects a delivery", async () => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", resendEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("RESEND_API_KEY", resendEnvironment.RESEND_API_KEY);
    vi.stubEnv("BREVO_API_KEY", brevoEnvironment.BREVO_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => ({ ...resendEnvironment, BREVO_API_KEY: brevoEnvironment.BREVO_API_KEY }) }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getAuthEmailDelivery } = await import("./email-delivery");

    await expect(getAuthEmailDelivery()!.sendPasswordReset({
      email: "user@example.test",
      name: null,
      resetUrl: "https://preview.example.test/reset-password?token=one-time-token",
      expiresAt: new Date("2026-11-12T01:00:00Z"),
    })).rejects.toThrow("Transactional email provider rejected the request (403).");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.resend.com/emails");
  });

  it.each([
    { label: "permission denied", outcome: () => Promise.resolve(new Response('{"name":"restricted_api_key"}', { status: 403 })), expected: { provider: "resend", httpStatus: 403, category: "provider_rejected" } },
    { label: "a timeout", outcome: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")), expected: { provider: "resend", httpStatus: null, category: "timeout" } },
    { label: "a network error", outcome: () => Promise.reject(new TypeError("fetch failed")), expected: { provider: "resend", httpStatus: null, category: "network_error" } },
    { label: "a missing message id", outcome: () => Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })), expected: { provider: "resend", httpStatus: 200, category: "invalid_response" } },
    { label: "a blank message id", outcome: () => Promise.resolve(new Response('{"id":"  "}', { status: 200, headers: { "Content-Type": "application/json" } })), expected: { provider: "resend", httpStatus: 200, category: "invalid_response" } },
  ])("logs only sanitized Resend diagnostics for $label", async ({ outcome, expected }) => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", resendEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("RESEND_API_KEY", resendEnvironment.RESEND_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => resendEnvironment }));
    vi.spyOn(globalThis, "fetch").mockImplementation(outcome);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getAuthEmailDelivery } = await import("./email-delivery");

    await expect(getAuthEmailDelivery()!.sendVerification({
      email: "recipient@example.test",
      name: "Recipient",
      verificationUrl: "https://preview.example.test/verify-email?token=one-time-token",
      expiresAt: new Date("2026-11-12T01:00:00Z"),
    })).rejects.toBeDefined();

    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith("auth_email_delivery_failed", expected);
    const logged = JSON.stringify(errorLog.mock.calls);
    for (const secret of [resendEnvironment.RESEND_API_KEY, "recipient@example.test", "one-time-token", "preview.example.test", "restricted_api_key"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("sends Brevo payloads with the verified sender and validates the response", async () => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", brevoEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("BREVO_API_KEY", brevoEnvironment.BREVO_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => brevoEnvironment }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messageId: "<brevo-message-id>" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    const infoLog = vi.spyOn(console, "info").mockImplementation(() => undefined);
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
    expect(infoLog).toHaveBeenCalledWith("auth_email_delivery_accepted", {
      provider: "brevo",
      httpStatus: 201,
      messageIdPresent: true,
    });
    expect(JSON.stringify(infoLog.mock.calls)).not.toContain("<brevo-message-id>");
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

  it.each([
    { label: "permission denied", outcome: () => Promise.resolve(new Response('{"code":"permission_denied"}', { status: 403 })), expected: { provider: "brevo", httpStatus: 403, category: "provider_rejected" } },
    { label: "a timeout", outcome: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")), expected: { provider: "brevo", httpStatus: null, category: "timeout" } },
    { label: "a network error", outcome: () => Promise.reject(new TypeError("fetch failed")), expected: { provider: "brevo", httpStatus: null, category: "network_error" } },
    { label: "a missing message id", outcome: () => Promise.resolve(new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } })), expected: { provider: "brevo", httpStatus: 201, category: "invalid_response" } },
  ])("logs only sanitized Brevo diagnostics for $label", async ({ outcome, expected }) => {
    vi.stubEnv("AUTH_EMAIL_PROVIDER", brevoEnvironment.AUTH_EMAIL_PROVIDER);
    vi.stubEnv("BREVO_API_KEY", brevoEnvironment.BREVO_API_KEY);
    vi.doMock("@/config/env", () => ({ getServerEnv: () => brevoEnvironment }));
    vi.spyOn(globalThis, "fetch").mockImplementation(outcome);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getAuthEmailDelivery } = await import("./email-delivery");
    await expect(getAuthEmailDelivery()!.sendVerification({
      email: "recipient@example.test",
      name: "Recipient",
      verificationUrl: "https://preview.example.test/verify-email?token=one-time-token",
      expiresAt: new Date("2026-11-12T01:00:00Z"),
    })).rejects.toBeDefined();
    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith("auth_email_delivery_failed", expected);
    const logged = JSON.stringify(errorLog.mock.calls);
    for (const secret of [brevoEnvironment.BREVO_API_KEY, "recipient@example.test", "one-time-token", "preview.example.test", "permission_denied"]) {
      expect(logged).not.toContain(secret);
    }
  });
});
