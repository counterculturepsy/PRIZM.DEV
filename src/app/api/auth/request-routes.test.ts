// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeRequestLimits: vi.fn(),
  getAuthEmailDelivery: vi.fn(),
  hashPassword: vi.fn(),
  mutationOriginError: vi.fn(),
  recordAuthSecurityEvent: vi.fn(),
  requestEmailVerification: vi.fn(),
  requestPasswordReset: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getServerEnv: () => ({ PASSWORD_AUTH_ENABLED: true, NEXTAUTH_URL: "https://preview.example.test" }) }));
vi.mock("@/modules/auth/password", () => ({ hashPassword: mocks.hashPassword }));
vi.mock("@/server/auth/email-delivery", () => ({ getAuthEmailDelivery: mocks.getAuthEmailDelivery }));
vi.mock("@/server/auth/events", () => ({ recordAuthSecurityEvent: mocks.recordAuthSecurityEvent }));
vi.mock("@/server/auth/route-security", () => ({ consumeRequestLimits: mocks.consumeRequestLimits, mutationOriginError: mocks.mutationOriginError }));
vi.mock("@/server/auth/tokens", () => ({ requestEmailVerification: mocks.requestEmailVerification, requestPasswordReset: mocks.requestPasswordReset }));
vi.mock("@/server/db", () => ({ getDatabase: () => ({ transaction: mocks.transaction }) }));

import { POST as register } from "./register/route";
import { POST as requestPasswordReset } from "./password-reset/request/route";
import { POST as requestVerification } from "./verify-email/request/route";

const accepted = { accepted: true };

function request(path: string, body: unknown) {
  return new Request(`https://preview.example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://preview.example.test" },
    body: JSON.stringify(body),
  });
}

async function bodyOf(response: Response) {
  return { status: response.status, body: await response.json() };
}

describe("public authentication request contracts", () => {
  beforeEach(() => {
    mocks.consumeRequestLimits.mockResolvedValue({ allowed: true, clientIp: "test-client" });
    mocks.getAuthEmailDelivery.mockReturnValue(null);
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.mutationOriginError.mockReturnValue(null);
    mocks.recordAuthSecurityEvent.mockResolvedValue(undefined);
    mocks.requestEmailVerification.mockResolvedValue({ accepted: true, deliveryOutcome: "provider_accepted" });
    mocks.requestPasswordReset.mockResolvedValue({ accepted: true, deliveryOutcome: "provider_accepted" });
    mocks.transaction.mockResolvedValue("created-user-id");
  });

  afterEach(() => vi.clearAllMocks());

  it.each([
    ["verification", requestVerification, mocks.requestEmailVerification],
    ["password reset", requestPasswordReset, mocks.requestPasswordReset],
  ] as const)("returns an identical generic response for %s outcomes", async (_label, handler, service) => {
    const results: Array<{ status: number; body: unknown }> = [];
    for (const deliveryOutcome of ["provider_accepted", "provider_failed", "provider_unavailable", "ineligible"] as const) {
      service.mockResolvedValueOnce({ accepted: true, deliveryOutcome });
      results.push(await bodyOf(await handler(request("/api/test", { email: "person@example.test" }))));
    }
    expect(results).toEqual(Array.from({ length: 4 }, () => ({ status: 202, body: accepted })));
    expect(JSON.stringify(results)).not.toMatch(/delivery|provider|recipient|token|credential|error/i);
  });

  it("returns the same registration response when verification and admin notification delivery fail", async () => {
    const sendPendingRegistration = vi.fn().mockRejectedValue(new Error("provider rejected"));
    mocks.getAuthEmailDelivery.mockReturnValue({ sendPendingRegistration });
    mocks.requestEmailVerification.mockResolvedValue({ accepted: true, deliveryOutcome: "provider_failed" });

    const response = await register(request("/api/auth/register", {
      name: "Preview User",
      email: "preview@example.test",
      password: "PreviewPassword123",
    }));

    expect(await bodyOf(response)).toEqual({ status: 202, body: accepted });
    expect(mocks.recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "pending_registration_notification", outcome: "delivery_failed" }));
  });

  it("records provider acceptance without exposing the internal delivery outcome", async () => {
    const sendPendingRegistration = vi.fn().mockResolvedValue(undefined);
    mocks.getAuthEmailDelivery.mockReturnValue({ sendPendingRegistration });
    mocks.requestEmailVerification.mockResolvedValue({ accepted: true, deliveryOutcome: "provider_accepted" });

    const response = await register(request("/api/auth/register", {
      name: "Accepted User",
      email: "accepted@example.test",
      password: "AcceptedPassword123",
    }));

    expect(await bodyOf(response)).toEqual({ status: 202, body: accepted });
    expect(mocks.recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "pending_registration_notification",
      outcome: "provider_accepted",
    }));
  });

  it("returns the same registration response for an existing account", async () => {
    mocks.transaction.mockRejectedValueOnce({ cause: { code: "23505" } });
    mocks.requestEmailVerification.mockResolvedValue({ accepted: true, deliveryOutcome: "ineligible" });

    const response = await register(request("/api/auth/register", {
      name: "Existing User",
      email: "existing@example.test",
      password: "ExistingPassword123",
    }));

    expect(await bodyOf(response)).toEqual({ status: 202, body: accepted });
    expect(mocks.getAuthEmailDelivery).not.toHaveBeenCalled();
  });

  it("keeps partial or unavailable provider configuration private", async () => {
    mocks.getAuthEmailDelivery.mockImplementationOnce(() => { throw new Error("missing provider credential"); });

    const response = await register(request("/api/auth/register", {
      name: "Configuration Test",
      email: "configuration@example.test",
      password: "ConfigurationPassword123",
    }));

    expect(await bodyOf(response)).toEqual({ status: 202, body: accepted });
    expect(mocks.recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "pending_registration_notification",
      outcome: "delivery_unavailable",
    }));
  });

  it("preserves validation and throttling responses", async () => {
    const invalid = await requestVerification(request("/api/auth/verify-email/request", { email: "not-an-email" }));
    expect(invalid.status).toBe(400);

    mocks.consumeRequestLimits.mockResolvedValueOnce({ allowed: false, clientIp: "test-client", retryAfterSeconds: 60 });
    const throttled = await requestPasswordReset(request("/api/auth/password-reset/request", { email: "person@example.test" }));
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("Retry-After")).toBe("60");
  });
});
