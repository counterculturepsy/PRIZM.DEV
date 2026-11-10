import type { DiscoveryLimits } from "./rate-limit";

export type Confidence = "high" | "medium" | "low";
export type FactKind = "observed" | "user_supplied" | "inferred" | "unknown";

export type SourcedValue<T> = Readonly<{
  value: T;
  kind: FactKind;
  confidence: Confidence;
  source: string;
  observedAt: string;
}>;

export type BusinessSearchQuery = Readonly<{
  countryCode: string;
  region?: string;
  city?: string;
  industries: readonly string[];
  cursor?: string;
  /** Search radius around the chosen place, for providers that search by distance. */
  radiusKm?: number;
}>;

export type BusinessSearchRecord = Readonly<{
  externalId: string;
  name: SourcedValue<string>;
  website?: SourcedValue<string>;
  phone?: SourcedValue<string>;
  email?: SourcedValue<string>;
  address?: SourcedValue<string>;
  city?: SourcedValue<string>;
  province?: SourcedValue<string>;
  industry?: SourcedValue<string>;
  sourceUrl?: string;
}>;

export type BusinessSearchPage = Readonly<{
  records: readonly BusinessSearchRecord[];
  cursor?: string;
  /** Run-level provenance (for example dataset id and data date) stored with every saved source record. */
  provenance?: Readonly<Record<string, string>>;
}>;

export interface BusinessSearchProvider {
  readonly id: string;
  search(query: BusinessSearchQuery): Promise<BusinessSearchPage>;
}

export type ProviderLicense = Readonly<{ name: string; url: string; attribution: string }>;

/** A provider that may be enabled by the operator once its terms are verified. */
export interface DiscoveryProvider extends BusinessSearchProvider {
  readonly displayName: string;
  readonly license: ProviderLicense;
  /** Per-workspace run limits. Omit to use the conservative defaults meant for public APIs. */
  readonly limits?: DiscoveryLimits;
}

export type DiscoveryErrorCode = "invalid_query" | "provider_rate_limited" | "provider_unavailable" | "provider_bad_response" | "provider_timeout";

/** Failure a user can act on; its message is safe to show and never contains credentials or raw responses. */
export class DiscoveryProviderError extends Error {
  constructor(readonly code: DiscoveryErrorCode, message: string) {
    super(message);
    this.name = "DiscoveryProviderError";
  }
}

export type MapsProvider = BusinessSearchProvider;

export interface ContactProvider {
  readonly id: string;
  findPublicChannels(domain: string): Promise<readonly SourcedValue<string>[]>;
}

export interface TechnologyProvider {
  readonly id: string;
  inspect(url: URL): Promise<readonly SourcedValue<string>[]>;
}

export interface SeoProvider {
  readonly id: string;
  inspect(url: URL): Promise<readonly SourcedValue<string>[]>;
}

export interface WebsiteAuditProvider {
  readonly id: string;
  audit(url: URL): Promise<readonly SourcedValue<string>[]>;
}

export class ProviderRegistry<TProvider extends { readonly id: string }> {
  readonly #providers = new Map<string, TProvider>();

  register(provider: TProvider): void {
    if (this.#providers.has(provider.id)) throw new Error(`Provider already registered: ${provider.id}`);
    this.#providers.set(provider.id, provider);
  }

  get(id: string): TProvider | undefined {
    return this.#providers.get(id);
  }

  list(): readonly TProvider[] {
    return [...this.#providers.values()];
  }
}

export class ProviderUnavailableError extends Error {
  constructor(providerId: string) {
    super(`Provider is not configured: ${providerId}`);
    this.name = "ProviderUnavailableError";
  }
}
