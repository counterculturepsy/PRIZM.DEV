import Link from "next/link";
import { notFound } from "next/navigation";
import { ApproveProposalForm, ReviseProposalForm } from "@/components/forms/proposal-forms";
import { AttachedPacks } from "@/components/app/attached-packs";
import { Hoax1gWordmark } from "@/components/brand/hoax1g-brand";
import { SourceEvidenceNotice } from "@/components/app/proposal-source-evidence-notice";
import { Card } from "@/components/ui/card";
import { classifySourceEvidence } from "@/modules/proposals/source-evidence";
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
  const evidenceState = classifySourceEvidence({ hasEvidenceSnapshot: Boolean(sourceEvidence), lead: proposal.lead });

  return <main className="mx-auto max-w-[1800px] px-5 py-10 sm:px-6">
    <nav aria-label="Proposal context" className="flex flex-wrap gap-4 text-sm">
      <Link className="text-primary" href="/app/proposals">Back to proposals</Link>
      <Link className="text-primary" href={`/app/leads/${proposal.leadId}`}>Back to CRM lead</Link>
    </nav>
    <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
      <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Proposal · version {proposal.currentVersion}</p><h1 className="mt-3 text-3xl font-semibold">{snapshot.title}</h1><p className="mt-2 text-sm capitalize text-muted-foreground">{proposal.status}{proposal.approvedAt ? ` · approved ${proposal.approvedAt.toLocaleString("en-ZA")}` : ""}</p><p className="mt-1 text-xs text-muted-foreground">Created by {proposal.createdBy.name ?? proposal.createdBy.email}{proposal.approvedBy ? ` · Current approval by ${proposal.approvedBy.name ?? proposal.approvedBy.email}` : ""}</p></div>
      <Link className="rounded-lg border border-border px-4 py-2 text-sm" href={`/app/proposals/${proposal.id}/print`}>Print current snapshot</Link>
    </div>
    <nav aria-label="Proposal workbench" className="mt-6 flex flex-wrap items-center gap-2 border-b border-border pb-4 text-xs"><a className="rounded-lg border border-cyan/50 bg-cyan/5 px-4 py-2 text-cyan" href="#proposal-content">Content</a><Link className="rounded-lg border border-border px-4 py-2" href={"/app/proposals/"+proposal.id+"/print"}>Print preview</Link><a className="rounded-lg border border-border px-4 py-2" href="#proposal-versions">Versions</a><span className="ml-auto rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-warning">{proposal.status === "draft" ? "Draft · review required" : proposal.status}</span></nav><div className="proposal-workbench mt-5"><aside className="proposal-outline sticky top-20 rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Proposal content</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Current saved snapshot · version {proposal.currentVersion}</p><nav aria-label="Proposal sections" className="mt-4 grid gap-2">{["Cover","Executive summary","Scope","Deliverables","Assumptions","Exclusions","Timeline guidance","Pricing","Source evidence"].map((label,index)=><a className="rounded-lg border border-border bg-background px-3 py-3 text-xs hover:border-primary hover:text-primary" href={"#proposal-section-"+index} key={label}>{label}</a>)}</nav></aside>
      <div className="grid min-w-0 gap-5" id="proposal-content"><article className="proposal-paper" id="proposal-section-0"><Hoax1gWordmark className="max-w-[220px]" /><p className="mt-12 text-[10px] uppercase tracking-[.4em] text-muted-foreground">Proposal · v{proposal.currentVersion}</p><h2 className="mt-4 text-3xl font-semibold tracking-tight">{snapshot.title}</h2><p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{snapshot.summary}</p><div className="mt-12 grid gap-5 border-t border-border pt-5 sm:grid-cols-2"><div><p className="text-[10px] uppercase tracking-widest text-cyan">Prepared for</p><Link className="mt-2 block text-sm font-medium" href={"/app/leads/"+proposal.leadId}>View recipient & CRM lead →</Link></div><div><p className="text-[10px] uppercase tracking-widest text-cyan">Prepared by</p><p className="mt-2 text-sm font-medium">HOAX1G.DEV STUDIOS</p><p className="mt-1 text-xs text-muted-foreground">{proposal.createdBy.name ?? proposal.createdBy.email}</p></div></div><div className="mt-8 flex items-center justify-between gap-4 border-t border-border pt-5"><p className="text-xs text-muted-foreground">Current proposal total</p><p className="text-xl font-semibold text-cyan">{money(snapshot.totalMinor,snapshot.currency)}</p></div></article>
        <Card id="proposal-section-1" className="p-6"><h2 className="font-semibold">Executive summary</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7">{snapshot.summary}</p></Card>
        {[
          ["Scope", snapshot.scope],
          ["Deliverables", snapshot.deliverables],
          ["Assumptions", snapshot.assumptions],
          ["Exclusions", snapshot.exclusions],
          ["Timeline guidance", snapshot.timeline],
        ].map(([title, text], index) => <Card id={"proposal-section-"+(index+2)} className="p-6" key={title}><h2 className="font-semibold">{title}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{text || "None stated"}</p></Card>)}
        <Card id="proposal-section-7" className="p-6"><h2 className="font-semibold">Pricing</h2>{snapshot.items.map((item, index) => <div className="mt-4 flex justify-between gap-4 text-sm" key={index}><span>{item.description} × {item.quantity}</span><span>{money(item.lineTotalMinor, snapshot.currency)}</span></div>)}<div className="mt-5 border-t border-border pt-4 text-sm"><p className="flex justify-between"><span>Subtotal</span><span>{money(snapshot.subtotalMinor, snapshot.currency)}</span></p><p className="mt-2 flex justify-between"><span>Discount</span><span>−{money(snapshot.discountMinor, snapshot.currency)}</span></p><p className="mt-3 flex justify-between text-lg font-semibold"><span>Total</span><span>{money(snapshot.totalMinor, snapshot.currency)}</span></p></div></Card>
        {sourceEvidence ? <Card id="proposal-section-8" className="p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">Immutable source-evidence snapshot</h2><p className="mt-2 text-xs leading-5 text-muted-foreground">Captured when version 1 was created and copied unchanged into later versions. This provenance does not update when upstream records change.</p></div><Link className="text-sm text-primary hover:underline" href={`/app/audits/${sourceEvidence.opportunity.auditId}`}>Open source audit</Link></div><div className="mt-5 rounded-xl border border-border p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{sourceEvidence.opportunity.type.replaceAll("_", " ")} · {sourceEvidence.opportunity.confidence} confidence</p><h3 className="mt-2 font-medium">{sourceEvidence.opportunity.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{sourceEvidence.opportunity.summary}</p><p className="mt-3 text-sm"><span className="font-medium">Observed impact:</span> {sourceEvidence.opportunity.businessImpact}</p><p className="mt-2 text-sm"><span className="font-medium">Recorded recommendation:</span> {sourceEvidence.opportunity.recommendedSolution}</p></div><div className="mt-5 grid gap-3">{sourceEvidence.findings.map((finding) => <article className="rounded-lg bg-background p-4" key={finding.id}><div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-medium">{finding.title}</h3><span className="text-xs capitalize text-muted-foreground">{finding.category} · {finding.severity}</span></div><p className="mt-2 text-sm">{finding.evidence}</p><p className="mt-2 text-xs text-muted-foreground">{finding.confidence} confidence · observed {new Date(finding.observedAt).toLocaleString("en-ZA")}</p></article>)}</div>{sourceEvidence.recommendations.length ? <div className="mt-5"><h3 className="text-sm font-semibold">Captured service recommendations</h3><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{sourceEvidence.recommendations.map((recommendation) => <li key={`${recommendation.rank}-${recommendation.serviceName}`}>{recommendation.rank}. {recommendation.serviceName}{recommendation.priceStatus === "configured" && recommendation.currency && recommendation.startingPriceMinor !== null ? ` · from ${money(recommendation.startingPriceMinor, recommendation.currency)}` : " · pricing not configured"}</li>)}</ul></div> : null}</Card> : <SourceEvidenceNotice state={evidenceState === "lead_without_source" ? "lead_without_source" : "no_snapshot"} />}
      </div>
      <aside className="grid content-start gap-5">
        {proposal.status === "draft" && hasCapability(scope, "manage_workspace") ? <Card className="p-6"><h2 className="mb-4 font-semibold">Internal approval</h2><ApproveProposalForm proposalId={proposal.id} /></Card> : <Card className="p-6 text-sm text-muted-foreground">{proposal.approvalNote ? `Approval note: ${proposal.approvalNote}` : "Only an Owner or Admin can approve the current draft."}</Card>}
        {hasCapability(scope, "write") ? <Card className="p-6"><details><summary className="cursor-pointer font-semibold">Create a new version</summary><div className="mt-5"><ReviseProposalForm proposalId={proposal.id} snapshot={snapshot} /></div></details></Card> : null}
        <AttachedPacks scope={scope} target={{ type: "proposal", id: proposal.id }} />
        <Card className="p-6"><h2 className="font-semibold">Lifecycle history</h2><ol className="mt-4 space-y-4">{proposal.history.map((event, index) => <li className="border-l border-border pl-4" key={`${event.action}-${event.createdAt.toISOString()}-${index}`}><p className="text-sm font-medium">{event.action.replace("proposal.", "Proposal ")}{event.version ? ` · version ${event.version}` : ""}</p><p className="mt-1 text-xs text-muted-foreground">{event.fromStatus ? `${event.fromStatus} → ` : ""}{event.toStatus ?? "recorded"} · {event.actor?.name ?? event.actor?.email ?? "System"} · {event.createdAt.toLocaleString("en-ZA")}</p>{event.note ? <p className="mt-2 text-xs">Approval note: {event.note}</p> : null}</li>)}</ol></Card>
        <Card id="proposal-versions" className="p-6"><h2 className="font-semibold">Version history</h2><ol className="mt-4 space-y-2 text-sm text-muted-foreground">{proposal.versions.map((version) => <li key={version.id}>Version {version.version} · {version.createdBy.name ?? version.createdBy.email} · {version.createdAt.toLocaleString("en-ZA")}</li>)}</ol></Card>
      </aside>
    </div>
  </main>;
}
