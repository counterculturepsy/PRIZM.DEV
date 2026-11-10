"use client";

import { useActionState } from "react";
import { runCompanyDiscoveryAction } from "@/app/app/discover/actions";
import type { FormState } from "@/app/app/actions";
import { FormMessage, SubmitButton } from "@/components/forms/form-parts";
import { Input, Label, selectClassName } from "@/components/ui/form-controls";

const initialState: FormState = { status: "idle" };

export function CompanyDiscoveryForm({ industries }: Readonly<{ industries: readonly string[] }>) {
  const [state, action] = useActionState(runCompanyDiscoveryAction, initialState);
  return <form action={action} className="grid gap-4 md:grid-cols-3">
    <div className="grid gap-2"><Label htmlFor="discovery-industry">Industry</Label><select className={selectClassName} defaultValue="" id="discovery-industry" name="industry" required><option disabled value="">Choose an industry</option>{industries.map((industry) => <option key={industry} value={industry}>{industry}</option>)}</select></div>
    <div className="grid gap-2"><Label htmlFor="discovery-city">City or town</Label><Input id="discovery-city" maxLength={80} name="city" placeholder="Cape Town" /></div>
    <div className="grid gap-2"><Label htmlFor="discovery-province">Province</Label><Input id="discovery-province" maxLength={80} name="province" placeholder="Western Cape" /></div>
    <p className="text-xs leading-5 text-muted-foreground md:col-span-3">Enter a city or town; the local extract needs one, and a province alone is not enough. Runs are limited per workspace and each saves up to 200 businesses that are named in the source data.</p>
    <div className="md:col-span-3"><FormMessage state={state} /></div>
    <div className="md:col-span-3"><SubmitButton pendingLabel="Searching…">Find companies</SubmitButton></div>
  </form>;
}
