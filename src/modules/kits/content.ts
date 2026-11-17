import { z } from "zod";

/** Public https links only; kits and case studies must not point at plain-http or script URLs. */
export const httpsUrlSchema = z.string().trim().max(2048).refine((value) => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}, "Use an https:// address.");

const optionalHttpsUrl = z.union([z.literal(""), httpsUrlSchema]);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour such as #8B5CF6.");
const shortText = (maximum: number) => z.string().trim().max(maximum);

export const DEFAULT_BRANDING = { wordmark: "HOAX1G.DEV", accentPrimary: "#8B5CF6", accentSecondary: "#22D3EE" } as const;

/** One immutable snapshot of a capability kit; editing a kit creates a new version of this shape. */
export const kitContentSchema = z.object({
  profile: z.object({
    displayName: z.string().trim().min(2).max(120),
    headline: shortText(160).default(""),
  }),
  introduction: shortText(2000).default(""),
  capabilities: z.array(z.object({
    group: z.string().trim().min(1).max(80),
    items: z.array(z.string().trim().min(1).max(80)).max(20),
  })).max(10).default([]),
  featuredCaseStudyIds: z.array(z.uuid()).max(6).default([]),
  approach: shortText(2500).default(""),
  services: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  contact: z.object({
    email: z.union([z.literal(""), z.string().trim().email().max(254)]).default(""),
    website: optionalHttpsUrl.default(""),
    phone: shortText(40).default(""),
    location: shortText(120).default(""),
  }).default({ email: "", website: "", phone: "", location: "" }),
  branding: z.object({
    wordmark: z.string().trim().min(1).max(40).default(DEFAULT_BRANDING.wordmark),
    accentPrimary: hexColor.default(DEFAULT_BRANDING.accentPrimary),
    accentSecondary: hexColor.default(DEFAULT_BRANDING.accentSecondary),
  }).default({ ...DEFAULT_BRANDING }),
  attachmentAssetIds: z.array(z.uuid()).max(10).default([]),
});

export type KitContent = z.infer<typeof kitContentSchema>;
export type KitContentInput = z.input<typeof kitContentSchema>;

export function emptyKitContent(displayName: string): KitContent {
  return kitContentSchema.parse({ profile: { displayName } });
}

export const developmentStatuses = ["concept", "in_development", "prototype", "live", "retired"] as const;
export type DevelopmentStatus = (typeof developmentStatuses)[number];

export const developmentStatusLabels: Record<DevelopmentStatus, string> = {
  concept: "Concept",
  in_development: "In development",
  prototype: "Prototype",
  live: "Live",
  retired: "Retired",
};

export const caseStudySchema = z.object({
  projectName: z.string().trim().min(2).max(160),
  problem: shortText(2000).default(""),
  solution: shortText(2000).default(""),
  techStack: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  responsibilities: shortText(2000).default(""),
  architectureSummary: shortText(2000).default(""),
  repositoryUrl: optionalHttpsUrl.default(""),
  demoUrl: optionalHttpsUrl.default(""),
  /** Only ever shown when `resultsVerified` is true; the app never writes metrics itself. */
  results: shortText(1500).default(""),
  resultsVerified: z.boolean().default(false),
  developmentStatus: z.enum(developmentStatuses),
});

export type CaseStudyInput = z.input<typeof caseStudySchema>;
export type CaseStudyValues = z.infer<typeof caseStudySchema>;
