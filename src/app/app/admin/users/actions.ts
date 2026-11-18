"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { changeAccountStatus, requirePlatformAdmin } from "@/server/admin/accounts";

const actionSchema = z.object({
  targetUserId: z.uuid(),
  action: z.enum(["approve", "reject", "suspend", "reactivate"]),
});

export async function updateAccountStatusAction(formData: FormData) {
  const parsed = actionSchema.safeParse({
    targetUserId: formData.get("targetUserId"),
    action: formData.get("action"),
  });
  if (!parsed.success) throw new Error("Invalid account administration request.");
  const admin = await requirePlatformAdmin();
  await changeAccountStatus(admin.id, parsed.data.targetUserId, parsed.data.action);
  revalidatePath("/app/admin/users");
}
