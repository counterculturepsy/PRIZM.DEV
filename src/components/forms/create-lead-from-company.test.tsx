import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/app/crm/actions", () => ({
  addCrmContactAction: vi.fn(),
  addCrmNoteAction: vi.fn(),
  addCrmTaskAction: vi.fn(),
  changeDealStageAction: vi.fn(),
  completeCrmTaskAction: vi.fn(),
  createCrmLeadAction: vi.fn(),
  suppressCrmContactAction: vi.fn(),
  updateLeadDetailsAction: vi.fn(),
}));

import { CreateLeadFromCompanyForm } from "./crm-forms";

const hidden = (container: HTMLElement, name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`);

describe("CreateLeadFromCompanyForm", () => {
  it("posts the company, no opportunity, and the company name as the lead title", () => {
    const { container } = render(<CreateLeadFromCompanyForm companyId="11111111-1111-4111-8111-111111111111" companyName="  ANEW Hotel Green Point " />);
    expect(screen.getByRole("button", { name: "Create lead" })).toBeInTheDocument();
    expect(hidden(container, "companyId")?.value).toBe("11111111-1111-4111-8111-111111111111");
    expect(hidden(container, "sourceOpportunityId")?.value).toBe("");
    expect(hidden(container, "title")?.value).toBe("ANEW Hotel Green Point");
  });

  it("keeps the title within the 2 to 160 character rule", () => {
    const short = render(<CreateLeadFromCompanyForm companyId="id" companyName="X" />);
    expect(hidden(short.container, "title")?.value).toBe("X lead");
    short.unmount();
    const long = render(<CreateLeadFromCompanyForm companyId="id" companyName={"N".repeat(400)} />);
    expect(hidden(long.container, "title")?.value).toHaveLength(160);
  });
});
