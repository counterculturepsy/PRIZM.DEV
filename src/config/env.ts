import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(8).optional(),
);

const optionalBoolean = z.preprocess(
  (value) => value === "" || value === undefined ? undefined : value === "true" ? true : value === "false" ? false : value,
  z.boolean().optional(),
);

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXTAUTH_URL: z.url(),
    DATABASE_URL: z.string().refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a PostgreSQL URL",
    ),
    AUTH_SECRET: z.string().min(32),
    AUTH_GITHUB_ID: optionalString,
    AUTH_GITHUB_SECRET: optionalSecret,
    AUTH_GOOGLE_ID: optionalString,
    AUTH_GOOGLE_SECRET: optionalSecret,
    PASSWORD_AUTH_ENABLED: optionalBoolean.default(false),
    OAUTH_LOGIN_ENABLED: optionalBoolean.default(true),
    DEV_AUTH_BYPASS: optionalBoolean.default(false),
    INTEGRATION_ENCRYPTION_KEY: optionalSecret,
    OPENAI_API_KEY: optionalSecret,
    AI_GENERATION_ENABLED: optionalBoolean.default(false),
    OPENAI_MODEL: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/).optional()),
    ANTHROPIC_API_KEY: optionalSecret,
    GOOGLE_GENERATIVE_AI_API_KEY: optionalSecret,
    WEBSITE_AUDIT_ENABLED: optionalBoolean.default(false),
    CAMPAIGN_DELIVERY_ENABLED: optionalBoolean.default(false),
    AUDIT_USER_AGENT: z.preprocess((value) => value === "" ? undefined : value, z.string().min(10).max(300).optional()).default("PRIZMDEV/1.0"),
    AUDIT_MAX_RESPONSE_BYTES: z.preprocess((value) => value === "" || value === undefined ? undefined : Number(value), z.number().int().min(100_000).max(2_000_000).optional()).default(2_000_000),
    DISCOVERY_PROVIDER: z.preprocess((value) => value === "" ? undefined : value, z.enum(["none", "overpass", "osm_extract"]).optional()).default("none"),
    DISCOVERY_TERMS_VERIFIED_FOR: optionalString,
    DISCOVERY_USER_AGENT: z.preprocess((value) => value === "" ? undefined : value, z.string().min(20).max(300).optional()),
    OVERPASS_API_URL: z.preprocess((value) => value === "" ? undefined : value, z.url().refine((url) => url.startsWith("https://"), "OVERPASS_API_URL must use https").optional()),
    OSM_EXTRACT_RADIUS_KM: z.preprocess((value) => value === "" || value === undefined ? undefined : Number(value), z.number().min(1).max(50).optional()),
  })
  .superRefine((value, context) => {
    if (value.DEV_AUTH_BYPASS && value.NODE_ENV !== "development") {
      context.addIssue({
        code: "custom",
        path: ["DEV_AUTH_BYPASS"],
        message: "DEV_AUTH_BYPASS is only permitted when NODE_ENV=development.",
      });
    }
    if (value.AI_GENERATION_ENABLED && (!value.OPENAI_API_KEY || !value.OPENAI_MODEL)) {
      context.addIssue({ code: "custom", path: ["AI_GENERATION_ENABLED"], message: "Enabled AI requires an OpenAI key and explicit model." });
    }
    if (value.CAMPAIGN_DELIVERY_ENABLED) {
      context.addIssue({ code: "custom", path: ["CAMPAIGN_DELIVERY_ENABLED"], message: "Campaign delivery has no approved provider adapter in this release." });
    }
    if (value.WEBSITE_AUDIT_ENABLED && (!/(https?:\/\/|@)/.test(value.AUDIT_USER_AGENT) || /\bexample\.(com|org|net)\b/i.test(value.AUDIT_USER_AGENT))) {
      context.addIssue({ code: "custom", path: ["AUDIT_USER_AGENT"], message: "When website audits are enabled, AUDIT_USER_AGENT must identify the crawler with a real contact URL or email address (not an example.com placeholder)." });
    }
    if (value.DISCOVERY_PROVIDER !== "none") {
      if (value.DISCOVERY_TERMS_VERIFIED_FOR !== value.DISCOVERY_PROVIDER) {
        context.addIssue({ code: "custom", path: ["DISCOVERY_TERMS_VERIFIED_FOR"], message: "Set DISCOVERY_TERMS_VERIFIED_FOR to the provider id only after its usage terms have been read and accepted." });
      }
      if (value.DISCOVERY_PROVIDER === "overpass" && (!value.DISCOVERY_USER_AGENT || !/(https?:\/\/|@)/.test(value.DISCOVERY_USER_AGENT))) {
        context.addIssue({ code: "custom", path: ["DISCOVERY_USER_AGENT"], message: "DISCOVERY_USER_AGENT must identify this application and include a contact URL or email address." });
      }
    }
    const pairs = [
      ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"],
      ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"],
    ] as const;

    for (const [idKey, secretKey] of pairs) {
      if (Boolean(value[idKey]) !== Boolean(value[secretKey])) {
        context.addIssue({
          code: "custom",
          path: [idKey],
          message: `${idKey} and ${secretKey} must be configured together`,
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server environment: ${fields}`);
  }
  return result.data;
}
