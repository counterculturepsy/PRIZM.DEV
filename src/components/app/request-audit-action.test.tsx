import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WEBSITE_AUDITING_DISABLED_MESSAGE } from "@/modules/audits/availability";
import { RequestAuditAction } from "./request-audit-action";

const companyId = "11111111-1111-4111-8111-111111111111";

describe("RequestAuditAction availability", () => {
  afterEach(cleanup);

  it("is a disabled, explained control rather than a link when auditing is unavailable", () => {
    render(<RequestAuditAction auditingEnabled={false} companyId={companyId} />);
    const control = screen.getByRole("button", { name: "Request website audit" });
    expect(control).toBeDisabled();
    expect(control).toHaveAccessibleDescription(WEBSITE_AUDITING_DISABLED_MESSAGE);
    expect(screen.queryByRole("link", { name: "Request website audit" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(WEBSITE_AUDITING_DISABLED_MESSAGE);
  });

  it("links to the audit request form for this company when auditing is enabled", () => {
    render(<RequestAuditAction auditingEnabled companyId={companyId} />);
    expect(screen.getByRole("link", { name: "Request website audit" })).toHaveAttribute("href", `/app/audits?companyId=${companyId}`);
    expect(screen.queryByRole("button", { name: "Request website audit" })).toBeNull();
  });
});
