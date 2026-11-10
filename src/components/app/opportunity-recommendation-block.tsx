import Link from "next/link";
import type { FeedRecommendation } from "@/modules/opportunities/feed";

/**
 * The only place a company report presents a service as recommended. It receives a summarized
 * recommendation, so non-preferred snapshot services never reach the page. `currentlyMappedCount` is live
 * configuration, shown only to explain an opportunity that has no snapshot; it never names a service.
 */
export function OpportunityRecommendationBlock({ recommendation, currentlyMappedCount }: Readonly<{ recommendation: FeedRecommendation; currentlyMappedCount: number }>) {
  return (
    <div className="mt-5 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">Recommended service</h3>
      {recommendation.kind === "preferred" ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{recommendation.serviceLabel}<span className="ml-2 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">Preferred</span></span>
          <span className="font-mono text-xs text-muted-foreground">{recommendation.priceLabel}</span>
        </div>
      ) : (
        <div className="mt-2 text-sm leading-6 text-muted-foreground">
          <p>{recommendation.serviceLabel}</p>
          <p className="font-mono text-xs">{recommendation.priceLabel}</p>
          {recommendation.kind === "none" ? (
            <p className="mt-2">
              {recommendation.note ? `${recommendation.note}: it was generated before service recommendations were recorded. ` : null}
              {currentlyMappedCount > 0 ? "Service mappings exist now; start a new audit to apply them. " : "No services are currently mapped to this opportunity type. "}
              <Link className="text-primary underline" href="/app/settings/services">Manage service mapping</Link>
            </p>
          ) : null}
        </div>
      )}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">A recommendation is a snapshot taken at generation time and does not affect the evidence or confidence below.</p>
    </div>
  );
}
