import type { DiscoveryPreview } from "@/server/prospecting/discovery-search";

/** Why a search did not return results. Each kind gets its own message and treatment in the UI. */
export type SearchFailureKind =
  | "not_enabled"
  | "invalid"
  | "unsupported_location"
  | "rate_limited"
  | "provider_unavailable";

export type SearchState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "results"; preview: DiscoveryPreview }>
  | Readonly<{ status: "error"; kind: SearchFailureKind; message: string; retryAfterSeconds?: number }>;

export type SaveState =
  | Readonly<{ status: "saved"; companyId: string; name: string; created: boolean }>
  | Readonly<{ status: "error"; message: string }>;
