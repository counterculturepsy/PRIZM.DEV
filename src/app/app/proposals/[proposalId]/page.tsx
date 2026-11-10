import Link from "next/link";
import { notFound } from "next/navigation";
import { ApproveProposalForm, ReviseProposalForm } from "@/components/forms/proposal-forms";
import { Card } from "@/components/ui/card";
import { hasCapability } from "@/modules/workspaces/scope";
import { getProposal } from "@/server/proposals/service";
import { getWorkspaceContext } from "@/server/workspaces/context";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(value / 100);
}

export default async function ProposalPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await params;
  const { scope } = await getWorkspaceContext("read");
  const proposal = await getProposal(scope, proposalId);
  if (!proposal) notFound();
  const snapshot = proposal.current.snapshot;
  const sourceEvidence = snapshot.sourceEvidence;

  return <main className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
    <nav aria-label="Proposal context" className="flex flex-wrap gap-4 text-sm">
      <Link className="text-primary" href="/app/proposals">Back to proposals</Link>
      <Link className="text-primary" href={`/app/leads/${proposal.leadId}`}>Back to CRM lead</Link>
    </nav>
    <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
      <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Proposal · version {proposal.currentVersion}</p><h1 className="mt-3 text-3xl font-semibold">{snapshot.title}</h1><p className="mt-2 text-sm capitalize text-muted-foreground">{proposal.status}{proposal.approvedAt ? ` · approved ${proposal.approvedAt.toLocaleString("en-ZA")}` : ""}</p><p className="mt-1 text-xs text-muted-foreground">Created by {proposal.createdBy.name ?? proposal.createdBy.email}{proposal.approvedBy ? ` · Current approval by ${proposal.approvedBy.name ?? proposal.approvedBy.email}` : ""}</p></div>
      <Link className="rounded-lg border border-border px-4 py-2 text-sm" href={`/app/proposals/${proposal.id}/print`}>Print current snapshot</Link>
    </div>
    <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.8fr]">
      <div className="grid gap-5">
        <Card className="p-6"><h2 className="font-semibold">Executive summary</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{snapshot.summary}</p></Card>
        {[
          ["Scope", snapshot.scope],
          ["Deliverables", snapshot.deliverables],
          ["Assumptions", snapshot.assumptions],
          ["Exclusions", snapshot.exclusions],
          ["Timeline guidance", snapshot.timeline],
        ].map(([title, text]) => <Card className="p-6" key={title}><h2 className="font-semibold">{title}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{text || "None stated"}</p></Card>)}
        <Card className="p-6"><h2 className="font-semibold">Pricing</h2>{snapshot.items.map((item, index) => <div className="mt-4 flex justify-between gap-4 text-sm" key={index}><span>{item.description} × {item.quantity}</span><span>{money(item.lineTotalMinor, snapshot.currency)}</span></div>)}<div className="mt-5 border-t border-border pt-4 text-sm"><p className="flex justify-between"><span>Subtotal</span><span>{money(snapshot.subtotalMinor, snapshot.currency)}</span></p><p className="mt-2 flex justify-between"><span>Discount</span><span>−{money(snapshot.discountMinor, snapshot.currency)}</span></p><p className="mt-3 flex justify-between text-lg font-semibold"><span>Total</span><span>{money(snapshot.totalMinor, snapshot.currency)}</span></p></div></Card>
        {sourceEvidence ? <Card className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Immutable source-evidence snapshot</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Captured when version 1 was created and copied unchanged into later versions. This provenance does not update when upstream records change.</p></div><Link className="text-sm text-primary hover:underline" href={`/app/audits/${sourceEvidence.opportunity.auditId}`}>Open source audit</Link></div><div className="mt-5 rounded-xl border border-border p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{sourceEvidence.opportunity.type.replaceAll("_", " ")} · {sourceEvidence.opportunity.confidence} confidence</p><h3 className="mt-2 font-medium">{sourceEvidence.opportunity.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{sourceEvidence.opportunity.summary}</p><p className="mt-3 text-sm"><span className="font-medium">Observed impact:</span> {sourceEvidence.opportunity.businessImpact}</p><p className="mt-2 text-sm"><span className="font-medium">Recorded recommendation:</span> {sourceEvidence.opportunity.recommendedSolution}</p></div><div className="mt-5 grid gap-3">{sourceEvidence.findings.map((finding) => <article className="rounded-lg bg-background p-4" key={finding.id}><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-medium">{finding.title}</h3><span className="text-xs capitalize text-muted-foreground">{finding.category} · {finding.severity}</span></div><p className="mt-2 text-sm">{finding.evidence}</p><p className="mt-2 text-xs text-muted-foreground">{finding.confidence} confidence · observed {new Date(finding.observedAt).toLocaleString("en-ZA")}</p></article>)}</div>{sourceEvidence.recommendations.length ? <div className="mt-5"><h3 className="text-sm font-semibold">Captured service recommendations</h3><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{sourceEvidence.recommendations.map((recommendation) => <li key={`${recommendation.rank}-${recommendation.serviceName}`}>{recommendation.rank}. {recommendation.serviceName}{recommendation.priceStatus === "configured" && recommendation.currency && recommendation.startingPriceMinor !== null ? ` · from ${money(recommendation.startingPriceMinor, recommendation.currency)}` : " · pricing not configured"}</li>)}</ul></div> : null}</Card> : <Card className="p-6"><h2 className="font-semibold">Source evidence</h2><p className="mt-2 text-sm text-muted-foreground">This legacy proposal version predates embedded evidence snapshots. Review its CRM lead and source audit before use.</p></Card>}
      </div>
      <aside className="grid content-start gap-5">
        {proposal.status === "draft" && hasCapability(scope, "manage_workspace") ? <Card className="p-6"><h2 className="mb-4 font-semibold">Internal approval</h2><ApproveProposalForm proposalId={proposal.id} /></Card> : <Card className="p-6 text-sm text-muted-foreground">{proposal.approvalNote ? `Approval note: ${proposal.approvalNote}` : "Only an Owner or Admin can approve the current draft."}</Card>}
        {hasCapability(scope, "write") ? <Card className="p-6"><details><summary className="cursor-pointer font-semibold">Create a new version</summary><div className="mt-5"><ReviseProposalForm proposalId={proposal.id} snapshot={snapshot} /></div></details></Card> : null}
        <Card className="p-6"><h2 className="font-semibold">Lifecycle history</h2><ol className="mt-4 space-y-4">{proposal.history.map((event, index) => <li className="border-l border-border pl-4" key={`${event.action}-${event.createdAt.toISOString()}-${index}`}><p className="text-sm font-medium">{event.action.replace("proposal.", "Proposal ")}{event.version ? ` · version ${event.version}` : ""}</p><p className="mt-1 text-xs text-muted-foreground">{event.fromStatus ? `${event.fromStatus} → ` : ""}{event.toStatus ?? "recorded"} · {event.actor?.name ?? event.actor?.email ?? "System"} · {event.createdAt.toLocaleString("en-ZA")}</p>{event.note ? <p className="mt-2 text-xs">Approval note: {event.note}</p> : null}</li>)}</ol></Card>
        <Card className="p-6"><h2 className="font-semibold">Version history</h2><ol className="mt-4 space-y-2 text-sm text-muted-foreground">{proposal.versions.map((version) => <li key={version.id}>Version {version.version} · {version.createdBy.name ?? version.createdBy.email} · {version.createdAt.toLocaleString("en-ZA")}</li>)}</ol></Card>
      </aside>
    </div>
  </main>;
}
