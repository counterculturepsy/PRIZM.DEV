import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/app/audits/actions", () => ({ queueWebsiteAuditAction: vi.fn() }));

import { WEBSITE_AUDITING_DISABLED_MESSAGE } from "@/modules/audits/availability";
import { AuditRequestForm } from "./audit-request-form";

const companies = [{ id: "11111111-1111-4111-8111-111111111111", name: "Aurora Guesthouse QA", website: "https://example.test" }];

describe("AuditRequestForm availability", () => {
  afterEach(cleanup);

  it("replaces the queue form with a disabled, explained control when auditing is unavailable", () => {
    const { container } = render(<AuditRequestForm auditingEnabled={false} companies={companies} />);
    const button = screen.getByRole("button", { name: "Queue website audit" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("type", "button");
    expect(screen.getByRole("status")).toHaveTextContent(WEBSITE_AUDITING_DISABLED_MESSAGE);
    expect(button).toHaveAccessibleDescription(WEBSITE_AUDITING_DISABLED_MESSAGE);
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('select[name="companyId"]')).toBeNull();
    expect(container.querySelector('input[name="authorization"]')).toBeNull();
    expect(container.textContent).not.toMatch(/WEBSITE_AUDIT_ENABLED/);
  });

  it("keeps the existing queue form when auditing is enabled", () => {
    const { container } = render(<AuditRequestForm auditingEnabled companies={companies} />);
    expect(screen.getByRole("button", { name: "Queue website audit" })).toBeEnabled();
    expect(container.querySelector("form")).not.toBeNull();
    expect(container.querySelector('select[name="companyId"]')).not.toBeNull();
    expect(container.querySelector('input[name="authorization"]')).not.toBeNull();
    expect(screen.queryByText(WEBSITE_AUDITING_DISABLED_MESSAGE)).toBeNull();
  });
});
