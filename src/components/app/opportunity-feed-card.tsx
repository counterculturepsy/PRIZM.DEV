import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { opportunityTypeLabels, type OpportunityType } from "@/modules/opportunities/generator";
import { severityLabel } from "@/modules/opportunities/feed";
import type { FindingSeverity, FeedCrmStatus, FeedRecommendation } from "@/modules/opportunities/feed";
import type { FitCheck } from "@/modules/scoring/dimensions";
import { FitChip } from "./opportunity-assessment";

const priorityStyle = {
  low: "bg-muted text-muted-foreground",
  possible: "bg-cyan/10 text-cyan",
  good: "bg-primary/10 text-primary",
  high: "bg-warning/10 text-warning",
  priority: "bg-success/10 text-success",
} as const;

export type OpportunityFeedRow = Readonly<{
  opportunityId: string;
  companyId: string;
  companyName: string;
  industry: string | null;
  city: string | null;
  type: OpportunityType;
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  totalScore: number;
  priority: keyof typeof priorityStyle;
  evidenceCount: number;
  highestSeverity: FindingSeverity | null;
  recommendation: FeedRecommendation;
  crm: FeedCrmStatus;
  suitability: Readonly<{ checks: FitCheck[] }>;
}>;

function Block({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <div className="rounded-lg bg-background p-3">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

export function OpportunityFeedCard({ row }: Readonly<{ row: OpportunityFeedRow }>) {
  const { recommendation, crm } = row;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${priorityStyle[row.priority]}`}>Lead priority {row.priority} · {row.totalScore}/100</span>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs">Highest finding severity: {severityLabel(row.highestSeverity)}</span>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs capitalize">{row.confidence} evidence confidence</span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">{row.evidenceCount} evidence</span>
      </div>
      <p className="mt-5 text-sm text-muted-foreground">{row.companyName}{row.industry ? ` · ${row.industry}` : ""}{row.city ? ` · ${row.city}` : ""}</p>
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-cyan">{opportunityTypeLabels[row.type]}</p>
      <h2 className="mt-1 text-xl font-semibold">{row.title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{row.summary}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Block title="Recommended service">
          <p className={recommendation.kind === "preferred" ? "font-medium" : "text-muted-foreground"}>{recommendation.serviceLabel}</p>
          {recommendation.note ? <p className="text-xs text-muted-foreground">{recommendation.note}</p> : null}
          <p className="mt-1 font-mono text-xs text-muted-foreground">{recommendation.priceLabel}</p>
        </Block>
        <Block title="Prospect suitability">
          <ul className="grid gap-1.5">
            {row.suitability.checks.map((check) => (
              <li className="flex flex-wrap items-center gap-2 text-xs" key={check.key}>
                <FitChip assessment={check.assessment} />
                <span>{check.label}</span>
              </li>
            ))}
          </ul>
        </Block>
        <Block title="CRM status">
          <p className={crm.kind === "none" ? "text-muted-foreground" : undefined}>{crm.label}</p>
        </Block>
      </div>
      <Link className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline" href={`/app/companies/${row.companyId}/opportunities`}>Review evidence <ArrowRight className="ml-2 size-4" /></Link>
    </Card>
  );
}
