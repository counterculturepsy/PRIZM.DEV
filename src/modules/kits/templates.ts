import { developmentStatusLabels, type DevelopmentStatus } from "./content";

export const packTemplateKeys = [
  "senior_developer_application",
  "saas_architect_application",
  "full_stack_engineer_application",
  "software_development_proposal",
  "ecommerce_development_proposal",
  "ai_automation_proposal",
  "partnership_introduction",
] as const;
export type PackTemplateKey = (typeof packTemplateKeys)[number];

export type PackTemplate = Readonly<{
  key: PackTemplateKey;
  label: string;
  category: "application" | "proposal" | "introduction";
  /** What the pack is for, in the sender's own words; used in the cover note ("about {purpose}"). */
  purposeHint: string;
  /** Guidance shown to the author while selecting case studies; it is advice, never inserted as a claim. */
  selectionGuidance: string;
  minCaseStudies: number;
  maxCaseStudies: number;
}>;

export const packTemplates: Readonly<Record<PackTemplateKey, PackTemplate>> = {
  senior_developer_application: {
    key: "senior_developer_application", label: "Senior Developer Application", category: "application",
    purposeHint: "the Senior Developer role", selectionGuidance: "Choose 2 to 4 projects that show ownership of design, delivery and maintenance.",
    minCaseStudies: 1, maxCaseStudies: 4,
  },
  saas_architect_application: {
    key: "saas_architect_application", label: "SaaS Architect Application", category: "application",
    purposeHint: "the SaaS Architect role", selectionGuidance: "Lead with multi-tenant, data-model and security work, and say which parts you personally designed.",
    minCaseStudies: 1, maxCaseStudies: 4,
  },
  full_stack_engineer_application: {
    key: "full_stack_engineer_application", label: "Full-Stack Engineer Application", category: "application",
    purposeHint: "the Full-Stack Engineer role", selectionGuidance: "Pick projects that span front end, back end, data and deployment.",
    minCaseStudies: 1, maxCaseStudies: 4,
  },
  software_development_proposal: {
    key: "software_development_proposal", label: "Software Development Proposal", category: "proposal",
    purposeHint: "your software development project", selectionGuidance: "Choose projects close to the client's problem and be explicit about what each one did and did not include.",
    minCaseStudies: 1, maxCaseStudies: 3,
  },
  ecommerce_development_proposal: {
    key: "ecommerce_development_proposal", label: "E-commerce Development Proposal", category: "proposal",
    purposeHint: "your e-commerce project", selectionGuidance: "Prefer storefront, payments and catalogue work, and state each project's real development status.",
    minCaseStudies: 1, maxCaseStudies: 3,
  },
  ai_automation_proposal: {
    key: "ai_automation_proposal", label: "AI Automation Proposal", category: "proposal",
    purposeHint: "your AI and automation project", selectionGuidance: "Show workflow automation and AI integration work, and keep any performance claims to verified results only.",
    minCaseStudies: 1, maxCaseStudies: 3,
  },
  partnership_introduction: {
    key: "partnership_introduction", label: "Partnership Introduction", category: "introduction",
    purposeHint: "a possible partnership", selectionGuidance: "Keep it short: one or two projects and a clear statement of what each side would bring.",
    minCaseStudies: 0, maxCaseStudies: 2,
  },
};

export function getPackTemplate(key: string): PackTemplate | null {
  // Own-property check: a bare lookup would also match inherited keys such as "__proto__" or "constructor".
  return Object.hasOwn(packTemplates, key) ? (packTemplates as Readonly<Record<string, PackTemplate>>)[key] ?? null : null;
}

export type CoverNoteInput = Readonly<{
  template: PackTemplate;
  senderName: string;
  recipientName: string;
  recipientOrganisation?: string | undefined;
  /** Typed by the author, for example "the Senior Developer role at Acme". Falls back to the template's hint. */
  purpose?: string | undefined;
  caseStudies: readonly { projectName: string; developmentStatus: DevelopmentStatus; techStack: readonly string[] }[];
}>;

/**
 * Assembles a plain cover note only from facts the author supplied or selected. It states no results,
 * credentials, testimonials or availability; the author reviews and edits it before anything is approved.
 */
export function buildCoverNote(input: CoverNoteInput): string {
  const purpose = input.purpose?.trim() || input.template.purposeHint;
  const lines = [
    `Hello ${input.recipientName.trim()},`,
    "",
    `I'm ${input.senderName.trim()}, writing about ${purpose}${input.recipientOrganisation?.trim() ? ` at ${input.recipientOrganisation.trim()}` : ""}.`,
  ];
  if (input.caseStudies.length > 0) {
    lines.push("", "My capability kit is attached. These are the projects I selected as most relevant:");
    for (const study of input.caseStudies) {
      const stack = study.techStack.slice(0, 6).join(", ");
      lines.push(`- ${study.projectName} (${developmentStatusLabels[study.developmentStatus]}${stack ? `; ${stack}` : ""})`);
    }
  } else {
    lines.push("", "My capability kit is attached.");
  }
  lines.push("", "I'm happy to answer any questions or share more detail.", "", `Kind regards,`, input.senderName.trim());
  return lines.join("\n");
}
