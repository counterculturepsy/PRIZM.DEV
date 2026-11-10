import type { OpportunityType } from "./generator";

/**
 * Exact slugs that the pre-mapping generator recognised. They are used only to seed
 * `opportunity_service_mappings` (migration 0011) for workspaces that already hold a
 * service with one of these slugs; the generator itself no longer consults slugs.
 */
export const LEGACY_SERVICE_ALIASES: Readonly<Record<OpportunityType, readonly string[]>> = {
  accessibility_remediation: ["accessibility", "accessibility-audit", "web-accessibility"],
  seo_improvement: ["seo", "search-engine-optimisation", "search-engine-optimization"],
  security_hardening: ["web-security", "website-security", "security-hardening"],
  performance_optimization: ["web-performance", "performance-optimization", "website-optimization"],
  mobile_experience: ["responsive-design", "mobile-web-design", "mobile-experience"],
  website_improvement: ["website-design", "web-design", "website-development", "web-development"],
};

export type MappableService = Readonly<{
  id: string;
  name: string;
  active: boolean;
  startingPriceMinor: number | null;
  averagePriceMinor: number | null;
}>;

export type ServiceMappingRow = Readonly<{ serviceId: string; isPreferred: boolean }>;

/**
 * - `configured`: at least one valid price is set on the service.
 * - `not_configured`: the service has no price; nothing is shown or estimated.
 * - `invalid`: stored prices are negative or inverted; they are not shown.
 */
export type PriceStatus = "configured" | "not_configured" | "invalid";

export type ServiceRecommendation = Readonly<{
  serviceId: string;
  serviceName: string;
  isPreferred: boolean;
  rank: number;
  priceStatus: PriceStatus;
  startingPriceMinor: number | null;
  averagePriceMinor: number | null;
  currency: string | null;
}>;

export function assessPrice(service: MappableService): { status: PriceStatus; minimum: number | null; maximum: number | null } {
  const { startingPriceMinor: minimum, averagePriceMinor: maximum } = service;
  if (minimum === null && maximum === null) return { status: "not_configured", minimum: null, maximum: null };
  const negative = (minimum !== null && minimum < 0) || (maximum !== null && maximum < 0);
  const inverted = minimum !== null && maximum !== null && maximum < minimum;
  if (negative || inverted) return { status: "invalid", minimum: null, maximum: null };
  return { status: "configured", minimum, maximum };
}

const byPreferredNameId = (
  left: { isPreferred: boolean; serviceName: string; serviceId: string },
  right: { isPreferred: boolean; serviceName: string; serviceId: string },
) => {
  if (left.isPreferred !== right.isPreferred) return left.isPreferred ? -1 : 1;
  const byName = left.serviceName.localeCompare(right.serviceName, "en", { sensitivity: "base" });
  if (byName !== 0) return byName;
  return left.serviceId < right.serviceId ? -1 : left.serviceId > right.serviceId ? 1 : 0;
};

/**
 * Turns a workspace's explicit mappings for one opportunity type into ordered recommendations.
 * Matching is independent of pricing: an active mapped service is always recommended, and its
 * price is carried only when the workspace configured one. Inactive or unknown services are dropped.
 * Ordering is preferred first, then service name, then service id (stable tie-breaker).
 */
export function resolveRecommendations(
  mappings: readonly ServiceMappingRow[],
  services: readonly MappableService[],
  currency: string,
): ServiceRecommendation[] {
  const byId = new Map(services.map((service) => [service.id, service]));
  const seen = new Set<string>();
  const candidates: Array<Omit<ServiceRecommendation, "rank">> = [];
  for (const mapping of mappings) {
    const service = byId.get(mapping.serviceId);
    if (!service || !service.active || seen.has(service.id)) continue;
    seen.add(service.id);
    const price = assessPrice(service);
    candidates.push({
      serviceId: service.id,
      serviceName: service.name,
      isPreferred: mapping.isPreferred,
      priceStatus: price.status,
      startingPriceMinor: price.minimum,
      averagePriceMinor: price.maximum,
      currency: price.status === "configured" ? currency : null,
    });
  }
  return candidates.sort(byPreferredNameId).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/** The opportunity-level link and price range come only from the preferred service. */
export function preferredOutcome(recommendations: readonly ServiceRecommendation[]) {
  const preferred = recommendations.find((item) => item.isPreferred);
  if (!preferred) return { serviceId: null, estimatedValueMinMinor: null, estimatedValueMaxMinor: null };
  return {
    serviceId: preferred.serviceId,
    estimatedValueMinMinor: preferred.startingPriceMinor,
    estimatedValueMaxMinor: preferred.averagePriceMinor,
  };
}

/**
 * The single wording used wherever a recommended service price is shown. Only configured prices are
 * formatted; a missing price is stated plainly and never estimated.
 */
export function describeRecommendationPrice(status: PriceStatus, minimum: number | null, maximum: number | null, currency: string | null): string {
  if (status === "not_configured") return "Price not configured";
  if (status === "invalid" || !currency || (minimum === null && maximum === null)) return "Price unavailable";
  const format = (amount: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount / 100);
  if (minimum !== null && maximum !== null) return `${format(minimum)}–${format(maximum)}`;
  return minimum !== null ? `From ${format(minimum)}` : `Typical ${format(maximum!)}`;
}
