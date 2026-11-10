"use server";

import { revalidatePath } from "next/cache";
import { parseMappingIntent } from "@/modules/opportunities/mapping-intent";
import type { FormState } from "@/app/app/actions";
import { addServiceMapping, MappingError, removeServiceMapping, setPreferredService } from "@/server/opportunities/mappings";
import { getWorkspaceContext } from "@/server/workspaces/context";

function field(formData: FormData) {
  return (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
}

export async function updateMappingAction(_state: FormState, formData: FormData): Promise<FormState> {
  const rawIntent = formData.get("intent");
  const intent = typeof rawIntent === "string" ? parseMappingIntent(rawIntent, field(formData)) : null;
  if (!intent) return { status: "error", message: "Choose a service and an action to update the mapping." };
  const { scope } = await getWorkspaceContext("manage_workspace");
  try {
    if (intent.kind === "add") await addServiceMapping(scope, intent);
    else if (intent.kind === "remove") await removeServiceMapping(scope, intent);
    else if (intent.kind === "prefer") await setPreferredService(scope, intent);
    else await setPreferredService(scope, { opportunityType: intent.opportunityType, serviceId: null });
  } catch (error) {
    if (error instanceof MappingError) return { status: "error", message: error.message };
    throw error;
  }
  revalidatePath("/app/settings/services");
  return { status: "success", message: "Mapping updated. New analyses will use it; existing opportunities are unchanged." };
}
