import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/app/settings/services/details-actions", () => ({ updateServiceDetailsAction: vi.fn() }));

import { ServiceCard, type ServiceCardData } from "./service-card";

afterEach(cleanup);

const service: ServiceCardData = {
  id: "5f1c2a52-9a3d-4d2e-8a9b-2b9d6d7e1a10",
  name: "Ongoing Maintenance & Technical Support",
  description: "Purpose line.\nNot included: redesign.",
  features: ["Updates", "Small fixes"],
  active: true,
  startingPriceMinor: null,
  averagePriceMinor: null,
};

describe("ServiceCard", () => {
  it("offers an edit form for description and features to owners and admins, and nothing else to edit", () => {
    const { container } = render(<ServiceCard canManage service={service} />);
    expect(screen.getByText("Edit details")).toBeTruthy();
    const description = screen.getByLabelText(/Description \(up to 500 characters\)/) as HTMLTextAreaElement;
    expect(description.maxLength).toBe(500);
    expect(description.value).toBe("Purpose line.\nNot included: redesign.");
    const features = screen.getByLabelText(/Features \(one per line, up to 12, 80 characters each\)/) as HTMLTextAreaElement;
    expect(features.value).toBe("Updates\nSmall fixes");
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect((container.querySelector('input[name="serviceId"]') as HTMLInputElement).value).toBe(service.id);
    expect(container.querySelector('[name="name"], [name="slug"], [name="active"], [name="startingPrice"], [name="deliveryTimeDays"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Save details" })).toBeTruthy();
  });

  it("is read-only for every other role: details are shown, nothing is editable", () => {
    render(<ServiceCard canManage={false} service={service} />);
    expect(screen.getByText("Ongoing Maintenance & Technical Support")).toBeTruthy();
    expect(screen.getByText(/Purpose line\./)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Features of Ongoing Maintenance & Technical Support" }).textContent).toContain("Small fixes");
    expect(screen.queryByText("Edit details")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("starts empty until descriptions are approved: no description text and no features list", () => {
    render(<ServiceCard canManage={false} service={{ ...service, description: "", features: [] }} />);
    expect(screen.getByText("No description provided.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getAllByText(/Not set/)).toHaveLength(1);
  });
});
