import type { Metadata } from "next";
import { ServiceCard } from "@/components/app/service-card";
import { OpportunityMappingEditor } from "@/components/forms/opportunity-mapping-editor";
import { ServiceForm } from "@/components/forms/service-form";
import { Card } from "@/components/ui/card";
import { hasCapability } from "@/modules/workspaces/scope";
import { getMappingOverview } from "@/server/opportunities/mappings";
import { getWorkspaceContext } from "@/server/workspaces/context";
import { listServices } from "@/server/workspaces/queries";

export const metadata: Metadata = { title: "Service settings" };

export default async function ServiceSettingsPage() {
  const { scope } = await getWorkspaceContext();
  const [rows, mappingOverview] = await Promise.all([listServices(scope), getMappingOverview(scope)]);
  const canManage = hasCapability(scope, "manage_workspace");
  return <><section className="grid gap-8 lg:grid-cols-[1fr_0.8fr]"><div><h2 className="text-xl font-semibold">Services</h2><p className="mt-2 text-sm text-muted-foreground">Your offer catalogue will inform opportunity ranking and proposal drafts.</p><div className="mt-6 grid gap-3">{rows.length === 0 ? <Card className="p-6 text-sm text-muted-foreground">No services yet.</Card> : rows.map((service) => <ServiceCard canManage={canManage} key={service.id} service={service} />)}</div></div><div>{canManage ? <Card className="p-6"><h2 className="mb-5 text-lg font-semibold">Add a service</h2><ServiceForm /></Card> : <Card className="p-6 text-sm text-muted-foreground">Only workspace owners and admins can change services.</Card>}</div></section>
    <section aria-labelledby="mapping-heading" className="mt-12"><h2 className="text-xl font-semibold" id="mapping-heading">Opportunity service mapping</h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Choose which of your services are recommended for each opportunity type, and optionally one preferred service. Mapping never changes audit evidence or confidence, and prices appear only where you configured them. Changes apply to analyses run after the change; existing opportunities keep the recommendations they were generated with.</p><div className="mt-6"><OpportunityMappingEditor canManage={canManage} overview={mappingOverview} /></div></section></>;
}
