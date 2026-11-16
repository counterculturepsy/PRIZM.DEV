import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("SignupForm", () => {
  afterEach(() => {
    cleanup();
    push.mockReset();
    vi.restoreAllMocks();
  });

  it("navigates an accepted registration to the neutral pending page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 202 }));
    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Preview User" } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "preview@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "PreviewPassword123" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/signup/pending"));
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("verification="));
  });
});
