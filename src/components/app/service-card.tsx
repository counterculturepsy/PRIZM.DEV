import { ServiceDetailsForm } from "@/components/forms/service-details-form";
import { Card } from "@/components/ui/card";

export type ServiceCardData = Readonly<{
  id: string;
  name: string;
  description: string;
  features: readonly string[];
  active: boolean;
  startingPriceMinor: number | null;
  averagePriceMinor: number | null;
}>;

function price(value: number | null, currency: string) {
  if (value === null) return "Not set";
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value / 100);
}

/** Read-only for every role; owners and admins also get an "Edit details" form for description and features. */
export function ServiceCard({ service, canManage }: Readonly<{ service: ServiceCardData; canManage: boolean }>) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{service.name}</h3>
          <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{service.description || "No description provided."}</p>
        </div>
        <span className="rounded-full bg-success/10 px-2 py-1 text-xs text-success">{service.active ? "Active" : "Inactive"}</span>
      </div>
      {service.features.length > 0 ? (
        <ul aria-label={`Features of ${service.name}`} className="mt-3 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
          {service.features.map((feature) => <li key={feature}>{feature}</li>)}
        </ul>
      ) : null}
      <p className="mt-4 font-mono text-xs text-muted-foreground">Starts {price(service.startingPriceMinor, "ZAR")} · Avg {price(service.averagePriceMinor, "ZAR")}</p>
      {canManage ? (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium text-primary">Edit details</summary>
          <ServiceDetailsForm description={service.description} features={service.features} serviceId={service.id} />
        </details>
      ) : null}
    </Card>
  );
}
