// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = vi.fn();
const recordAuthSecurityEvent = vi.fn();
const sendPendingRegistration = vi.fn();

vi.mock("@/config/env", () => ({ getServerEnv: () => ({ PASSWORD_AUTH_ENABLED: true, NEXTAUTH_URL: "https://app.example.test" }) }));
vi.mock("@/modules/auth/password", () => ({ hashPassword: async () => "password-hash" }));
vi.mock("@/server/auth/route-security", () => ({
  mutationOriginError: () => null,
  consumeRequestLimits: async () => ({ allowed: true, clientIp: "203.0.113.10", retryAfterSeconds: 0 }),
}));
vi.mock("@/server/auth/events", () => ({ recordAuthSecurityEvent }));
vi.mock("@/server/auth/tokens", () => ({ requestEmailVerification: async () => ({ accepted: true, deliveryOutcome: "provider_failed" }) }));
vi.mock("@/server/auth/email-delivery", () => ({ getAuthEmailDelivery: () => ({ sendPendingRegistration }) }));
vi.mock("@/server/db", () => ({ getDatabase: () => ({ transaction }) }));

function registration(email: string): Request {
  return new Request("https://app.example.test/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test Person", email, password: "InitialPassword123" }),
  });
}

async function publicShape(response: Response) {
  return { status: response.status, cacheControl: response.headers.get("Cache-Control"), body: await response.json() };
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    transaction.mockReset();
    recordAuthSecurityEvent.mockReset();
    sendPendingRegistration.mockReset().mockRejectedValue(new Error("provider rejected request"));
  });

  it("returns an identical public response for new and existing accounts when delivery fails", async () => {
    transaction
      .mockResolvedValueOnce("new-user-id")
      .mockRejectedValueOnce(Object.assign(new Error("duplicate"), { cause: { code: "23505" } }));
    const { POST } = await import("./route");

    const created = await publicShape(await POST(registration("new@example.test")));
    const existing = await publicShape(await POST(registration("existing@example.test")));

    expect(created).toEqual(existing);
    expect(created).toEqual({ status: 202, cacheControl: "no-store", body: { accepted: true } });
    expect(recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "pending_registration_notification", outcome: "delivery_failed" }));
    expect(recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "registration", outcome: "created" }));
    expect(recordAuthSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "registration", outcome: "accepted_existing" }));
  });
});
