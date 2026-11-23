import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { BusinessSearchRecord } from "@/modules/prospecting/providers";

const TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_TOKEN_CHARS = 8_000;
const DOMAIN = "prizm.discovery.candidate.v1:";

const sourcedValue = z.object({
  value: z.string().max(500),
  kind: z.enum(["observed", "user_supplied", "inferred", "unknown"]),
  confidence: z.enum(["high", "medium", "low"]),
  source: z.string().max(80),
  observedAt: z.string().max(40),
});

const recordSchema = z.object({
  externalId: z.string().min(1).max(120),
  name: sourcedValue,
  website: sourcedValue.optional(),
  phone: sourcedValue.optional(),
  email: sourcedValue.optional(),
  address: sourcedValue.optional(),
  city: sourcedValue.optional(),
  province: sourcedValue.optional(),
  industry: sourcedValue.optional(),
  sourceUrl: z.string().max(500).optional(),
});

const payloadSchema = z.object({
  v: z.literal(1),
  ws: z.uuid(),
  provider: z.string().min(1).max(40),
  country: z.string().regex(/^[A-Z]{2}$/),
  record: recordSchema,
  provenance: z.record(z.string(), z.string().max(300)),
  exp: z.number().int(),
});

export type CandidatePayload = Readonly<{
  provider: string;
  country: string;
  record: BusinessSearchRecord;
  provenance: Readonly<Record<string, string>>;
}>;

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(DOMAIN + body).digest();
}

/**
 * Signs a search result so it can be saved later without trusting the browser. The token is bound to one workspace
 * and expires after an hour. It carries data, not authority: saving still requires a signed-in writer.
 */
export function signCandidate(secret: string, workspaceId: string, candidate: CandidatePayload, now: Date): string {
  const body = Buffer.from(JSON.stringify({ v: 1, ws: workspaceId, ...candidate, exp: now.getTime() + TOKEN_TTL_MS })).toString("base64url");
  return `${body}.${mac(secret, body).toString("base64url")}`;
}

/** Returns the payload only for an untampered, unexpired token issued for this workspace. */
export function verifyCandidate(secret: string, workspaceId: string, token: string, now: Date): CandidatePayload | null {
  if (token.length > MAX_TOKEN_CHARS) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = mac(secret, body);
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success || parsed.data.ws !== workspaceId || parsed.data.exp < now.getTime()) return null;
  const { provider, country, record, provenance } = parsed.data;
  return { provider, country, record: record as BusinessSearchRecord, provenance };
}
