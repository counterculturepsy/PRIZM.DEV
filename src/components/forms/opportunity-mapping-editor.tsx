"use client";

import { useActionState } from "react";
import { Star } from "lucide-react";
import type { FormState } from "@/app/app/actions";
import { updateMappingAction } from "@/app/app/settings/services/mapping-actions";
import { Card } from "@/components/ui/card";
import { selectClassName } from "@/components/ui/form-controls";
import { describeRecommendationPrice } from "@/modules/opportunities/mapping";
import type { getMappingOverview } from "@/server/opportunities/mappings";
import { FormMessage } from "./form-parts";

type Overview = Awaited<ReturnType<typeof getMappingOverview>>;

const initialState: FormState = { status: "idle" };

const buttonClass = "min-h-9 rounded-md border border-border px-3 text-xs font-medium hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function OpportunityMappingEditor({ overview, canManage }: Readonly<{ overview: Overview; canManage: boolean }>) {
  const [state, action, pending] = useActionState(updateMappingAction, initialState);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      {overview.types.map((entry) => {
        const mappedIds = new Set(entry.services.map((service) => service.serviceId));
        const addable = overview.catalogue.filter((service) => service.active && !mappedIds.has(service.id));
        return (
          <Card className="p-5" key={entry.type}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">{entry.label}</h3>
              {entry.effectiveCount === 0
                ? <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs text-warning">Unmapped · opportunities are still generated, with no service recommendation</span>
                : <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs text-success">{entry.effectiveCount} active {entry.effectiveCount === 1 ? "service" : "services"}</span>}
            </div>
            {entry.services.length > 0 ? (
              <ul className="mt-4 grid gap-2">
                {entry.services.map((service) => (
                  <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background p-3" key={service.serviceId}>
                    <div>
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {service.isPreferred ? <Star aria-hidden className="size-4 fill-current text-warning" /> : null}
                        {service.serviceName}
                        {service.isPreferred ? <span className="text-xs font-normal text-warning">Preferred</span> : null}
                        {service.active ? null : <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">Inactive · ignored</span>}
                      </p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{describeRecommendationPrice(service.priceStatus, service.startingPriceMinor, service.averagePriceMinor, service.priceStatus === "configured" ? overview.currency : null)}</p>
                    </div>
                    {canManage ? (
                      <div className="flex gap-2">
                        {service.isPreferred
                          ? <button className={buttonClass} disabled={pending} name="intent" type="submit" value={`clear:${entry.type}`}>Clear preferred</button>
                          : <button className={buttonClass} disabled={pending || !service.active} name="intent" type="submit" value={`prefer:${entry.type}:${service.serviceId}`}>Make preferred</button>}
                        <button className={buttonClass} disabled={pending} name="intent" type="submit" value={`remove:${entry.type}:${service.serviceId}`}>Remove</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {canManage && addable.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`add-${entry.type}`}>Add a service to {entry.label}</label>
                <select className={`${selectClassName} max-w-sm`} defaultValue="" id={`add-${entry.type}`} name={`add-${entry.type}`}>
                  <option disabled value="">Add a service…</option>
                  {addable.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                </select>
                <button className={buttonClass} disabled={pending} name="intent" type="submit" value={`add:${entry.type}`}>Add</button>
              </div>
            ) : null}
          </Card>
        );
      })}
    </form>
  );
}
