import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { ApprovePackForm, AttachPackForm, DetachPackForm, RevokeLinkForm, ShareLinkForm, UpdatePackForm } from "@/components/forms/kit-forms";
import { Card } from "@/components/ui/card";
import { developmentStatusLabels, type DevelopmentStatus } from "@/modules/kits/content";
import { packTemplates, type PackTemplateKey } from "@/modules/kits/templates";
import { hasCapability } from "@/modules/workspaces/scope";
import { UUID_PATTERN } from "@/server/kits/http";
import { listCaseStudies, listKitAssets } from "@/server/kits/library";
import { getKitPack, listAttachmentTargets, listKitAccessEvents, listKitShareLinks, listPackAttachments } from "@/server/kits/packs";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Application pack" };

export default async function PackPage({ params }: { params: Promise<{ packId: string }> }) {
  const { scope } = await getWorkspaceContext("read");
  const { packId } = await params;
  if (!UUID_PATTERN.test(packId)) notFound();
  const view = await getKitPack(scope, packId);
  if (!view) notFound();
  const [studies, assets, attachments, targets, links, events] = await Promise.all([
    listCaseStudies(scope), listKitAssets(scope), listPackAttachments(scope, packId), listAttachmentTargets(scope), listKitShareLinks(scope, packId), listKitAccessEvents(scope, packId),
  ]);
  const { pack } = view;
  const canWrite = hasCapability(scope, "write");
  const canManage = hasCapability(scope, "manage_workspace");
  const approved = pack.status === "approved";
  const needsReapproval = approved && !view.approvalCurrent;
  const template = packTemplates[pack.templateKey as PackTemplateKey];
  return <main className="mx-auto max-w-6xl px-5 py-10 sm:px-6 lg:px-8">
    <Link className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground" href="/app/kits"><ArrowLeft className="mr-2 size-4" />Back to capability kits</Link>
    <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
      <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">{template?.label ?? pack.templateKey} · kit {view.kitName} v{pack.kitVersion}</p><h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{pack.title}</h1><p className="mt-2 text-muted-foreground">For {pack.recipientName}{pack.recipientOrganisation ? `, ${pack.recipientOrganisation}` : ""}</p></div>
      <span className={`rounded-full px-3 py-1.5 text-sm capitalize ${approved && !needsReapproval ? "bg-success/15 text-success" : "bg-muted"}`}>{needsReapproval ? "changed since approval" : pack.status}</span>
    </div>
    <div className="mt-4 flex flex-wrap gap-4 text-sm"><a className="text-primary underline" href={`/api/kits/packs/${pack.id}/pdf`}>Download PDF</a><a className="text-primary underline" href={`/api/kits/packs/${pack.id}/pdf?inline=1`} rel="noreferrer" target="_blank">Preview PDF</a></div>
    {template ? <p className="mt-3 text-sm text-muted-foreground">{template.selectionGuidance}</p> : null}

    <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <Card className="p-6"><h2 className="text-lg font-semibold">Review and edit</h2>
        {canWrite ? <div className="mt-5"><UpdatePackForm assets={assets.map((asset) => ({ id: asset.id, label: `${asset.title} · ${asset.kind}` }))} caseStudies={studies.map((study) => ({ id: study.id, label: `${study.projectName} (${developmentStatusLabels[study.developmentStatus as DevelopmentStatus]})` }))} kitIsBehind={view.kitIsBehind} pack={pack} selectedAssetIds={view.documents.map((doc) => doc.assetId)} selectedCaseStudyIds={view.caseStudies.map((study) => study.id)} /></div>
          : <pre className="mt-4 whitespace-pre-wrap text-sm">{pack.message}</pre>}
      </Card>

      <div className="grid content-start gap-6">
        <Card className="p-6"><h2 className="text-lg font-semibold">Approval</h2>
          <p className="mt-2 text-sm text-muted-foreground">Approval confirms the recipient, cover note, case studies and documents exactly as shown. Any later change returns the pack to draft.</p>
          {approved && !needsReapproval ? <p className="mt-4 text-sm text-success">Approved {pack.approvedAt?.toLocaleString("en-ZA")}.</p> : canManage ? <div className="mt-4"><ApprovePackForm packId={pack.id} /></div> : <p className="mt-4 text-sm text-muted-foreground">A workspace owner or administrator approves packs.</p>}
        </Card>

        <Card className="p-6"><h2 className="text-lg font-semibold">Attachments</h2>
          <div className="mt-4 grid gap-2">{attachments.length === 0 ? <p className="text-sm text-muted-foreground">Not attached to anything.</p> : attachments.map((item) => <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm" key={item.id}><span className="capitalize">{item.targetType}: {item.leadTitle ?? item.proposalTitle ?? item.campaignName}</span>{canWrite ? <DetachPackForm attachmentId={item.id} packId={pack.id} /> : null}</div>)}</div>
          {canWrite && approved && !needsReapproval ? <div className="mt-5"><AttachPackForm campaigns={targets.campaigns} leads={targets.leads} packId={pack.id} proposals={targets.proposals} /></div> : <p className="mt-4 text-xs text-muted-foreground">Approve the pack to attach it.</p>}
        </Card>

        <Card className="p-6"><h2 className="text-lg font-semibold">Share links</h2>
          <div className="mt-4 grid gap-2">{links.length === 0 ? <p className="text-sm text-muted-foreground">No links yet.</p> : links.map((link) => {
            const state = link.state;
            return <div className="rounded-xl border border-border p-3 text-sm" key={link.id}><div className="flex items-center justify-between gap-3"><span className="capitalize">{state}</span><span className="font-mono text-xs text-muted-foreground">{link.downloadCount}{link.maxDownloads ? `/${link.maxDownloads}` : ""} downloads</span></div><p className="mt-1 text-xs text-muted-foreground">Expires {link.expiresAt.toLocaleString("en-ZA")}</p>{canWrite && state === "active" ? <div className="mt-2"><RevokeLinkForm linkId={link.id} packId={pack.id} /></div> : null}</div>;
          })}</div>
          {canManage && approved && !needsReapproval ? <div className="mt-5"><ShareLinkForm packId={pack.id} /></div> : <p className="mt-4 text-xs text-muted-foreground">Only an owner or administrator can create links, and only for an approved pack.</p>}
        </Card>

        <Card className="p-6"><h2 className="text-lg font-semibold">Access log</h2><div className="mt-4 grid gap-2">{events.length === 0 ? <p className="text-sm text-muted-foreground">No downloads yet.</p> : events.slice(0, 15).map((event) => <p className="text-xs text-muted-foreground" key={event.id}>{event.createdAt.toLocaleString("en-ZA")} · {event.eventType.replaceAll("_", " ")}</p>)}</div></Card>
      </div>
    </div>
  </main>;
}
