import { z } from "zod";
import { workspaceRoles } from "./scope";

export const workspaceNameSchema = z.string().trim().min(2).max(80);

export const createWorkspaceSchema = z.object({ name: workspaceNameSchema });

export const selectWorkspaceSchema = z.object({ workspaceId: z.uuid() });

export const inviteMemberSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(workspaceRoles).exclude(["owner"]),
});

export const serviceInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  startingPrice: z.coerce.number().int().min(0).max(10_000_000).optional(),
  averagePrice: z.coerce.number().int().min(0).max(10_000_000).optional(),
  deliveryTimeDays: z.coerce.number().int().min(1).max(730).optional(),
});

export const SERVICE_DESCRIPTION_MAX = 500;
export const SERVICE_FEATURES_MAX = 12;
export const SERVICE_FEATURE_MAX_LENGTH = 80;

/** Trims entries, drops blanks and removes exact duplicates (the first occurrence wins). */
export function normalizeFeatures(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    const value = entry.trim();
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** One feature per line, as entered in the service details form. */
export function parseFeatureLines(text: string): string[] {
  return normalizeFeatures(text.split(/\r?\n/));
}

/**
 * The only service fields the details editor may change. Name, slug, active status, prices and delivery
 * time are deliberately absent, so they cannot be edited through this schema.
 */
export const serviceDetailsSchema = z.object({
  serviceId: z.uuid(),
  description: z.string().trim().max(SERVICE_DESCRIPTION_MAX, `Description must be ${SERVICE_DESCRIPTION_MAX} characters or fewer.`),
  features: z
    .array(z.string().max(1_000), "Features must be a list of text entries.")
    .max(100, "Too many feature lines.")
    .transform(normalizeFeatures)
    .pipe(
      z.array(z.string().max(SERVICE_FEATURE_MAX_LENGTH, `Each feature must be ${SERVICE_FEATURE_MAX_LENGTH} characters or fewer.`))
        .max(SERVICE_FEATURES_MAX, `Use at most ${SERVICE_FEATURES_MAX} features.`),
    ),
});

const listFromText = z.string().transform((value) =>
  [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))].slice(0, 50),
);

export const idealCustomerProfileInputSchema = z
  .object({
    cities: listFromText.pipe(z.array(z.string().min(2).max(80)).min(1).max(30)),
    industries: listFromText.pipe(z.array(z.string().min(2).max(80)).min(1).max(30)),
    minimumBudget: z.coerce.number().int().min(0).max(10_000_000),
    maximumBudget: z.coerce.number().int().min(0).max(10_000_000),
  })
  .refine((value) => value.maximumBudget >= value.minimumBudget, {
    path: ["maximumBudget"],
    message: "Maximum budget must be greater than or equal to minimum budget",
  });

export const onboardingSchema = idealCustomerProfileInputSchema.and(
  z.object({ services: listFromText.pipe(z.array(z.string().min(2).max(80)).min(1).max(20)) }),
);

export function toSlug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "workspace";
}
