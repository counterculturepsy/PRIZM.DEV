import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "./env";

const valid = {
  NODE_ENV: "test",
  NEXTAUTH_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://user:password@localhost:5432/prizm",
  AUTH_SECRET: "a-test-secret-that-is-longer-than-thirty-two-characters",
};

describe("serverEnvSchema", () => {
  it("accepts the minimum safe configuration", () => {
    expect(serverEnvSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an incomplete OAuth provider pair", () => {
    const result = serverEnvSchema.safeParse({ ...valid, AUTH_GITHUB_ID: "client-id" });
    expect(result.success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, AUTH_GOOGLE_ID: "google-client-id" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, AUTH_GOOGLE_SECRET: "google-client-secret" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, AUTH_GOOGLE_ID: "google-client-id", AUTH_GOOGLE_SECRET: "google-client-secret" }).success).toBe(true);
  });

  it("rejects non-PostgreSQL database URLs", () => {
    const result = serverEnvSchema.safeParse({ ...valid, DATABASE_URL: "sqlite://local.db" });
    expect(result.success).toBe(false);
  });

  it("allows the authentication bypass only in local development", () => {
    const development = { ...valid, NODE_ENV: "development", DEV_AUTH_BYPASS: "true" };
    expect(serverEnvSchema.parse(development).DEV_AUTH_BYPASS).toBe(true);
    expect(serverEnvSchema.safeParse({ ...development, NODE_ENV: "test" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...development, NODE_ENV: "production" }).success).toBe(false);
  });

  it("keeps password authentication disabled unless explicitly enabled", () => {
    expect(serverEnvSchema.parse(valid).PASSWORD_AUTH_ENABLED).toBe(false);
    expect(serverEnvSchema.parse({ ...valid, PASSWORD_AUTH_ENABLED: "true" }).PASSWORD_AUTH_ENABLED).toBe(true);
    expect(serverEnvSchema.safeParse({ ...valid, PASSWORD_AUTH_ENABLED: "yes" }).success).toBe(false);
  });

  it("allows OAuth login to be disabled without deleting provider credentials", () => {
    expect(serverEnvSchema.parse(valid).OAUTH_LOGIN_ENABLED).toBe(true);
    expect(serverEnvSchema.parse({ ...valid, OAUTH_LOGIN_ENABLED: "false" }).OAUTH_LOGIN_ENABLED).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, OAUTH_LOGIN_ENABLED: "yes" }).success).toBe(false);
  });

  it("requires a complete transactional email configuration", () => {
    const complete = {
      ...valid,
      RESEND_API_KEY: "re_test_key_long_enough",
      AUTH_EMAIL_FROM: "PRIZM.DEV <auth@prizm.example>",
      AUTH_EMAIL_REPLY_TO: "support@prizm.example",
      ADMIN_NOTIFICATION_EMAIL: "admin@prizm.example",
    };
    expect(serverEnvSchema.safeParse(complete).success).toBe(true);
    expect(serverEnvSchema.safeParse({ ...valid, RESEND_API_KEY: complete.RESEND_API_KEY }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, AUTH_EMAIL_FROM: complete.AUTH_EMAIL_FROM }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, ADMIN_NOTIFICATION_EMAIL: complete.ADMIN_NOTIFICATION_EMAIL }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, AUTH_EMAIL_REPLY_TO: complete.AUTH_EMAIL_REPLY_TO }).success).toBe(false);
  });

  it("selects and validates Brevo without weakening Resend compatibility", () => {
    const common = {
      ...valid,
      AUTH_EMAIL_FROM: "PRIZM.DEV <countercultureliveact@gmail.com>",
      ADMIN_NOTIFICATION_EMAIL: "admin@prizm.example",
    };
    expect(serverEnvSchema.safeParse({
      ...common,
      AUTH_EMAIL_PROVIDER: "brevo",
      BREVO_API_KEY: "xkeysib-test-key-long-enough",
    }).success).toBe(true);
    expect(serverEnvSchema.safeParse({ ...common, AUTH_EMAIL_PROVIDER: "brevo" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...common, BREVO_API_KEY: "xkeysib-test-key-long-enough" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...common, AUTH_EMAIL_PROVIDER: "unknown", BREVO_API_KEY: "xkeysib-test-key-long-enough" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...common, RESEND_API_KEY: "re_test_key_long_enough" }).success).toBe(true);
  });

  it("rejects malformed authentication sender identities", () => {
    const configured = {
      ...valid,
      AUTH_EMAIL_PROVIDER: "brevo",
      BREVO_API_KEY: "xkeysib-test-key-long-enough",
      ADMIN_NOTIFICATION_EMAIL: "admin@prizm.example",
    };
    expect(serverEnvSchema.safeParse({ ...configured, AUTH_EMAIL_FROM: "PRIZM.DEV <not-an-email>" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...configured, AUTH_EMAIL_FROM: "not-an-email" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...configured, AUTH_EMAIL_FROM: "countercultureliveact@gmail.com" }).success).toBe(true);
  });

  it("rejects ambiguous website audit switches", () => {
    expect(serverEnvSchema.safeParse({ ...valid, WEBSITE_AUDIT_ENABLED: "yes" }).success).toBe(false);
    expect(serverEnvSchema.parse({ ...valid, WEBSITE_AUDIT_ENABLED: "false" }).WEBSITE_AUDIT_ENABLED).toBe(false);
  });

  it("keeps external discovery off unless a provider is configured and its terms are acknowledged", () => {
    expect(serverEnvSchema.parse(valid).DISCOVERY_PROVIDER).toBe("none");
    expect(serverEnvSchema.parse({ ...valid, DISCOVERY_PROVIDER: "" }).DISCOVERY_PROVIDER).toBe("none");
    expect(serverEnvSchema.safeParse({ ...valid, DISCOVERY_PROVIDER: "overpass" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, DISCOVERY_PROVIDER: "unknown" }).success).toBe(false);
  });

  it("requires terms acknowledgement and a contactable user agent to enable a provider", () => {
    const enabled = {
      ...valid,
      DISCOVERY_PROVIDER: "overpass",
      DISCOVERY_TERMS_VERIFIED_FOR: "overpass",
      DISCOVERY_USER_AGENT: "PRIZMDEV/1.0 (https://example.com/contact)",
    };
    expect(serverEnvSchema.safeParse(enabled).success).toBe(true);
    expect(serverEnvSchema.safeParse({ ...enabled, DISCOVERY_TERMS_VERIFIED_FOR: "someone-else" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...enabled, DISCOVERY_USER_AGENT: "PRIZMDEV/1.0 anonymous app" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...enabled, OVERPASS_API_URL: "http://insecure.example/api" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...enabled, OVERPASS_API_URL: "https://overpass.example/api/interpreter" }).success).toBe(true);
  });

  it("enables the local extract without a user agent, but still requires the terms acknowledgement", () => {
    const base = { ...valid, DISCOVERY_PROVIDER: "osm_extract" };
    expect(serverEnvSchema.safeParse(base).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...base, DISCOVERY_TERMS_VERIFIED_FOR: "overpass" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...base, DISCOVERY_TERMS_VERIFIED_FOR: "osm_extract" }).success).toBe(true);
    const withRadius = (radius: string) => serverEnvSchema.safeParse({ ...base, DISCOVERY_TERMS_VERIFIED_FOR: "osm_extract", OSM_EXTRACT_RADIUS_KM: radius });
    expect(withRadius("15").success && withRadius("15").data?.OSM_EXTRACT_RADIUS_KM).toBe(15);
    expect(withRadius("500").success).toBe(false);
    expect(withRadius("0").success).toBe(false);
  });

  it("requires a real crawler contact before website audits can be enabled", () => {
    const enabled = { ...valid, WEBSITE_AUDIT_ENABLED: "true" };
    expect(serverEnvSchema.safeParse(valid).success).toBe(true);
    expect(serverEnvSchema.safeParse(enabled).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...enabled, AUDIT_USER_AGENT: "PRIZMDEV/1.0 anonymous crawler" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...enabled, AUDIT_USER_AGENT: "PRIZMDEV/1.0 (+https://example.com/audit-policy)" }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...enabled, AUDIT_USER_AGENT: "PRIZMDEV/1.0 (+https://my-domain.test/crawler)" }).success).toBe(true);
    expect(serverEnvSchema.safeParse({ ...enabled, AUDIT_USER_AGENT: "PRIZMDEV/1.0 (crawler@my-domain.test)" }).success).toBe(true);
  });

  it("keeps campaign delivery fail-closed in this release", () => {
    expect(serverEnvSchema.parse({ ...valid, CAMPAIGN_DELIVERY_ENABLED: "false" }).CAMPAIGN_DELIVERY_ENABLED).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, CAMPAIGN_DELIVERY_ENABLED: "true" }).success).toBe(false);
  });
});
