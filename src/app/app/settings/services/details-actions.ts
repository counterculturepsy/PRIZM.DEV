"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/app/app/actions";
import { parseFeatureLines } from "@/modules/workspaces/validation";
import { getWorkspaceContext } from "@/server/workspaces/context";
import { ServiceDetailsError, updateServiceDetails } from "@/server/workspaces/service-details";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function updateServiceDetailsAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { scope } = await getWorkspaceContext("manage_workspace");
  try {
    const result = await updateServiceDetails(scope, {
      serviceId: text(formData, "serviceId"),
      description: text(formData, "description"),
      features: parseFeatureLines(text(formData, "features")),
    });
    revalidatePath("/app/settings/services");
    return { status: "success", message: result.changed ? "Service details saved." : "No changes to save." };
  } catch (error) {
    if (error instanceof ServiceDetailsError) return { status: "error", message: error.message };
    throw error;
  }
}
