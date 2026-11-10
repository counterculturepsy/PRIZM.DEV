import { createHmac } from "node:crypto";
import { getServerEnv } from "@/config/env";
import { getDatabase } from "@/server/db";
import { authSecurityEvents } from "@/server/db/schema";

export type AuthSecurityEvent = Readonly<{
  eventType: string;
  outcome: string;
  userId?: string | null | undefined;
  identifier?: string | null | undefined;
  clientIp?: string | null | undefined;
  metadata?: Record<string, string | number | boolean | null>;
}>;

function pseudonymize(kind: "identifier" | "ip", value: string): string {
  return createHmac("sha256", getServerEnv().AUTH_SECRET)
    .update(`${kind}:${value.trim().toLowerCase()}`)
    .digest("hex");
}

export async function recordAuthSecurityEvent(event: AuthSecurityEvent): Promise<void> {
  await getDatabase().insert(authSecurityEvents).values({
    eventType: event.eventType,
    outcome: event.outcome,
    userId: event.userId ?? null,
    identifierHash: event.identifier ? pseudonymize("identifier", event.identifier) : null,
    ipHash: event.clientIp ? pseudonymize("ip", event.clientIp) : null,
    metadata: event.metadata ?? {},
  });
}
