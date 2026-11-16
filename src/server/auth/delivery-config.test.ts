// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const getAuthEmailDelivery = vi.hoisted(() => vi.fn());
vi.mock("./email-delivery", () => ({ getAuthEmailDelivery }));

import { getConfiguredAuthEmailDelivery } from "./delivery-config";

describe("getConfiguredAuthEmailDelivery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getAuthEmailDelivery.mockReset();
  });

  it("returns the configured delivery unchanged", () => {
    const delivery = { sendVerification: vi.fn() };
    getAuthEmailDelivery.mockReturnValue(delivery);
    expect(getConfiguredAuthEmailDelivery()).toBe(delivery);
  });

  it("returns null without logging when email is not configured", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getAuthEmailDelivery.mockReturnValue(null);
    expect(getConfiguredAuthEmailDelivery()).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it("returns null and logs only the error category when the configuration is invalid", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getAuthEmailDelivery.mockImplementation(() => {
      throw new Error("RESEND_API_KEY is invalid: sk-test-secret");
    });
    expect(getConfiguredAuthEmailDelivery()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("auth_email_delivery_unconfigured", { category: "Error" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("sk-test-secret");
  });

  it("classifies a non-Error throw without leaking its value", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getAuthEmailDelivery.mockImplementation(() => {
      throw "plain string with sk-test-secret";
    });
    expect(getConfiguredAuthEmailDelivery()).toBeNull();
    expect(error).toHaveBeenCalledWith("auth_email_delivery_unconfigured", { category: "unknown" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("sk-test-secret");
  });
});
