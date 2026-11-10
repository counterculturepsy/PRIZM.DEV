import { Card } from "@/components/ui/card";
import type { Assessment, OpportunityAssessment } from "@/modules/scoring/dimensions";

const assessmentStyle: Record<Assessment, { label: string; className: string }> = {
  positive: { label: "Match", className: "bg-success/10 text-success" },
  negative: { label: "Verified mismatch", className: "bg-error/10 text-error" },
  missing: { label: "Missing data", className: "bg-warning/10 text-warning" },
};

export function FitChip({ assessment }: Readonly<{ assessment: Assessment }>) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${assessmentStyle[assessment].className}`}>{assessmentStyle[assessment].label}</span>;
}

function Section({ title, value, children }: Readonly<{ title: string; value?: string; children: React.ReactNode }>) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-sm font-medium">{title}</dt>
        {value ? <dd className="font-mono text-sm">{value}</dd> : null}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{children}</div>
    </div>
  );
}

export function OpportunityAssessmentCard({ assessment }: Readonly<{ assessment: OpportunityAssessment }>) {
  const { websiteHealth, observedNeed, prospectSuitability, evidenceQuality } = assessment;
  return (
    <Card className="mt-4 p-6">
      <h2 className="font-semibold">Assessment</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Four separate questions. The overall score above combines the second and third; it is not a sales probability.</p>
      <dl className="mt-4 grid gap-5">
        <Section title="Website health" value={websiteHealth.score === null ? "Not scored" : `${websiteHealth.score}/100`}>{websiteHealth.detail}</Section>
        <Section title="Observed need" value={`${observedNeed.points}/${observedNeed.maxPoints}`}>{observedNeed.detail}</Section>
        <Section title="Prospect suitability" value={`${prospectSuitability.points}/${prospectSuitability.maxPoints}`}>
          <ul className="grid gap-2">
            {prospectSuitability.checks.map((check) => (
              <li key={check.key}>
                <span className="mr-2"><FitChip assessment={check.assessment} /></span>
                <span className="font-medium text-foreground">{check.label}.</span> {check.detail}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Evidence quality" value={evidenceQuality.total === 0 ? "No findings" : `${evidenceQuality.high} high · ${evidenceQuality.medium} medium · ${evidenceQuality.low} low`}>{evidenceQuality.detail}</Section>
      </dl>
    </Card>
  );
}
