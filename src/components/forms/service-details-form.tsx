"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/app/actions";
import { updateServiceDetailsAction } from "@/app/app/settings/services/details-actions";
import { Label, Textarea } from "@/components/ui/form-controls";
import { SERVICE_DESCRIPTION_MAX, SERVICE_FEATURE_MAX_LENGTH, SERVICE_FEATURES_MAX } from "@/modules/workspaces/validation";
import { FormMessage, SubmitButton } from "./form-parts";

const initialState: FormState = { status: "idle" };

/** Edits only a service's description and feature list; name, slug, status, prices and delivery are not editable here. */
export function ServiceDetailsForm({ serviceId, description, features }: Readonly<{ serviceId: string; description: string; features: readonly string[] }>) {
  const [state, action] = useActionState(updateServiceDetailsAction, initialState);
  return (
    <form action={action} className="mt-4 grid gap-4">
      <input name="serviceId" type="hidden" value={serviceId} />
      <div className="grid gap-2">
        <Label htmlFor={`details-description-${serviceId}`}>Description (up to {SERVICE_DESCRIPTION_MAX} characters)</Label>
        <Textarea defaultValue={description} id={`details-description-${serviceId}`} maxLength={SERVICE_DESCRIPTION_MAX} name="description" rows={6} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`details-features-${serviceId}`}>Features (one per line, up to {SERVICE_FEATURES_MAX}, {SERVICE_FEATURE_MAX_LENGTH} characters each)</Label>
        <Textarea defaultValue={features.join("\n")} id={`details-features-${serviceId}`} name="features" rows={5} />
      </div>
      <FormMessage state={state} />
      <SubmitButton>Save details</SubmitButton>
    </form>
  );
}
