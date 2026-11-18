import { z } from "zod";

export const dealStages = ["identified", "contacted", "discovery", "proposal", "negotiation", "won", "lost"] as const;
export type DealStage = (typeof dealStages)[number];

const optionalUuid = z.union([z.literal(""), z.uuid()]).transform((value) => value || undefined);
const optionalText = (maximum: number) => z.string().trim().max(maximum).transform((value) => value || undefined);

export const createLeadSchema = z.object({
  companyId: z.uuid(),
  sourceOpportunityId: optionalUuid.optional(),
  title: z.string().trim().min(2).max(160),
});

export const updateDealStageSchema = z.object({
  leadId: z.uuid(),
  stage: z.enum(dealStages),
  lostReason: optionalText(500).optional(),
}).superRefine((value, context) => {
  if (value.stage === "lost" && !value.lostReason) {
    context.addIssue({ code: "custom", path: ["lostReason"], message: "Add a brief reason when closing a deal as lost." });
  }
});

/** Parses a major-unit amount ("12500", "12 500,50") to integer minor units without floating-point rounding. */
export function parseMoneyMinor(value: string): number | null | undefined {
  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return undefined;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export const updateLeadDetailsSchema = z.object({
  leadId: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
  title: z.string().trim().min(2).max(160),
  ownerUserId: optionalUuid.optional(),
  dealValue: z.string().max(24),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code."),
  expectedCloseDate: z.union([z.literal(""), z.iso.date()]),
}).transform((value, context) => {
  const dealValueMinor = parseMoneyMinor(value.dealValue);
  if (dealValueMinor === undefined) {
    context.addIssue({ code: "custom", path: ["dealValue"], message: "Enter an amount such as 12500 or 12500.50 (up to 7 digits before the decimal)." });
    return z.NEVER;
  }
  return {
    leadId: value.leadId,
    expectedUpdatedAt: new Date(value.expectedUpdatedAt),
    title: value.title,
    ownerUserId: value.ownerUserId ?? null,
    dealValueMinor,
    currency: value.currency,
    expectedCloseAt: value.expectedCloseDate ? new Date(`${value.expectedCloseDate}T00:00:00.000Z`) : null,
  };
});

export const createContactSchema = z.object({
  leadId: z.uuid(),
  firstName: z.string().trim().min(1).max(80),
  lastName: optionalText(80).optional(),
  roleTitle: optionalText(120).optional(),
  email: optionalText(254).optional(),
  phone: optionalText(40).optional(),
  sourceKind: z.enum(["user_supplied", "observed"]),
  sourceLabel: z.string().trim().min(2).max(160),
  sourceUrl: z.union([z.literal(""), z.url().max(2048)]).optional().transform((value) => value || undefined),
  confidence: z.enum(["high", "medium", "low"]),
}).superRefine((value, context) => {
  if (!value.email && !value.phone) {
    context.addIssue({ code: "custom", path: ["email"], message: "Add an email address or phone number." });
  }
  if (value.email && !z.email().safeParse(value.email).success) {
    context.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email address." });
  }
});

export const createNoteSchema = z.object({ leadId: z.uuid(), body: z.string().trim().min(1).max(2000) });

export const createTaskSchema = z.object({
  leadId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  description: optionalText(1000).optional(),
  dueAt: z.union([z.literal(""), z.iso.datetime({ local: true })]).optional().transform((value) => value ? new Date(value) : undefined),
  assignedToUserId: optionalUuid.optional(),
});

export const completeTaskSchema = z.object({ taskId: z.uuid() });
export const suppressContactSchema = z.object({
  leadId: z.uuid(),
  contactId: z.uuid(),
  channel: z.enum(["email", "phone"]),
  reason: z.string().trim().min(2).max(500),
});

export function normalizeEmail(value: string | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

export function normalizePhone(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function dealLifecycle(stage: DealStage, now = new Date()) {
  return stage === "won" || stage === "lost"
    ? { closedAt: now }
    : { closedAt: null };
}
