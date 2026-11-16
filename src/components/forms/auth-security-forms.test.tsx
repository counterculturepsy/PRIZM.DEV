import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthEmailRequestForm } from "./auth-security-forms";

const purposes = ["verification", "password reset"] as const;

async function submitWith(purpose: (typeof purposes)[number], body: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 202 }));
  render(<AuthEmailRequestForm endpoint="/api/test" purpose={purpose} />);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "someone@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: `Request ${purpose}` }));
  return screen.findByRole("status");
}

describe("AuthEmailRequestForm", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(purposes)("acknowledges a %s request without exposing delivery state", async (purpose) => {
    const status = await submitWith(purpose, { accepted: true });
    expect(status).toHaveTextContent(
      `Request received. If an account matches this address, you may receive a ${purpose} email with further instructions. Please check your inbox and spam folder. If nothing arrives after 10 minutes, you can request another link.`,
    );
    expect(status).not.toHaveTextContent(/has been sent|was sent|we sent|not configured|no .* email was sent/i);
  });
});
