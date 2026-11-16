import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PendingAccountPage from "./page";

afterEach(cleanup);

async function renderPending() {
  render(await PendingAccountPage());
  return screen.getByRole("status");
}

describe("PendingAccountPage", () => {
  it("acknowledges registration without claiming an email was delivered", async () => {
    const status = await renderPending();
    expect(screen.getByRole("heading", { name: "Verification request received" })).toBeInTheDocument();
    expect(status).toHaveTextContent(
      "If your account requires verification, you may receive an email with further instructions. Please check your inbox and spam folder. If nothing arrives after 10 minutes, you can request another link.",
    );
    expect(screen.getByText(/administrator approval/i)).toBeInTheDocument();
    expect(status).not.toHaveTextContent(/has been sent|was sent|we sent|not configured/i);
  });
});
