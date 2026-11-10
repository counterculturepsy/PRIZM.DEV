import { z } from "zod";
import { opportunityTypes } from "./generator";

const typeSchema = z.enum(opportunityTypes);
const idSchema = z.uuid();

export type MappingIntent =
  | Readonly<{ kind: "add" | "remove" | "prefer"; opportunityType: (typeof opportunityTypes)[number]; serviceId: string }>
  | Readonly<{ kind: "clear"; opportunityType: (typeof opportunityTypes)[number] }>;

/**
 * The editor submits one form; the clicked button carries its intent:
 * `add:<type>` (service taken from the `add-<type>` select), `remove:<type>:<serviceId>`,
 * `prefer:<type>:<serviceId>` and `clear:<type>`. Anything else is rejected.
 */
export function parseMappingIntent(intent: string, field: (name: string) => string): MappingIntent | null {
  const [kind, rawType, rawService, ...rest] = intent.split(":");
  if (rest.length > 0) return null;
  const type = typeSchema.safeParse(rawType);
  if (!type.success) return null;
  if (kind === "clear" && rawService === undefined) return { kind, opportunityType: type.data };
  if (kind === "add" && rawService === undefined) {
    const service = idSchema.safeParse(field(`add-${type.data}`));
    return service.success ? { kind, opportunityType: type.data, serviceId: service.data } : null;
  }
  if ((kind === "remove" || kind === "prefer") && rawService !== undefined) {
    const service = idSchema.safeParse(rawService);
    return service.success ? { kind, opportunityType: type.data, serviceId: service.data } : null;
  }
  return null;
}
