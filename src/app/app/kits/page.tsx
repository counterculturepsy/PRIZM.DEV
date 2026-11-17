import type { Metadata } from "next";
import Link from "next/link";
import { AssetStatusForm, CaseStudyForm, CreatePackForm, KitForm, PurgeForm, UploadAssetForm } from "@/components/forms/kit-forms";
import { Card } from "@/components/ui/card";
import { developmentStatusLabels, type DevelopmentStatus } from "@/modules/kits/content";
import { packTemplates, type PackTemplateKey } from "@/modules/kits/templates";
import { hasCapability } from "@/modules/workspaces/scope";
import { listCapabilityKits, listCaseStudies, listKitAssets } from "@/server/kits/library";
import { listAttachmentTargets, listKitPacks } from "@/server/kits/packs";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Capability kits" };

const kib = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

export default async function KitsPage() {
  const { scope } = await getWorkspaceContext("read");
  const canWrite = hasCapability(scope, "write");
  const [kits, allAssets, studies, packs, targets] = await Promise.all([listCapabilityKits(scope), listKitAssets(scope, { includeArchived: true }), listCaseStudies(scope), listKitPacks(scope), listAttachmentTargets(scope)]);
  const assets = allAssets.filter((asset) => asset.status === "active");
  const archivedAssets = allAssets.filter((asset) => asset.status === "archived");
  const canManage = hasCapability(scope, "manage_workspace");
  const studyOptions = studies.map((study) => ({ id: study.id, label: `${study.projectName} (${developmentStatusLabels[study.developmentStatus as DevelopmentStatus]})` }));
  const assetOptions = assets.map((asset) => ({ id: asset.id, label: `${asset.title} · ${asset.kind}` }));
  return <main className="mx-auto max-w-7xl px-5 py-10 sm:px-6 lg:px-8">
    <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Professional capability</p>
    <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Capability kits</h1>
    <p className="mt-3 max-w-3xl text-muted-foreground">Build a branded media kit, keep supporting documents private, and assemble a reviewed pack for each recipient. Nothing is sent from here: packs are approved by a person and shared only through links you create and can revoke.</p>

    <div className="mt-8 grid gap-6 xl:grid-cols-2">
      <Card className="p-6"><h2 className="text-lg font-semibold">Kits</h2>
        <div className="mt-4 grid gap-2">{kits.length === 0 ? <p className="text-sm text-muted-foreground">No kits yet.</p> : kits.map((kit) => <Link className="flex items-center justify-between rounded-xl border border-border p-3 text-sm hover:border-primary" href={`/app/kits/${kit.id}`} key={kit.id}><span>{kit.name}</span><span className="font-mono text-xs text-muted-foreground">v{kit.currentVersion}</span></Link>)}</div>
        {canWrite ? <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-primary">Create a kit</summary><div className="mt-4"><KitForm assets={assetOptions} caseStudies={studyOptions} /></div></details> : null}
      </Card>

      <Card className="p-6"><h2 className="text-lg font-semibold">Documents</h2>
        <p className="mt-1 text-sm text-muted-foreground">Private to this workspace. PDFs and images are checked by content before they are stored.</p>
        <div className="mt-4 grid gap-2">{assets.length === 0 ? <p className="text-sm text-muted-foreground">No documents yet.</p> : assets.map((asset) => <div className="rounded-xl border border-border p-3 text-sm" key={asset.id}>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{asset.title}</span><span className="font-mono text-xs text-muted-foreground">v{asset.currentVersion} · {kib(asset.byteSize)}{asset.pageCount ? ` · ${asset.pageCount} pp` : ""}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{asset.filename}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs"><a className="text-primary underline" href={`/api/kits/assets/${asset.id}`}>Download</a><a className="text-primary underline" href={`/api/kits/assets/${asset.id}?inline=1`} rel="noreferrer" target="_blank">Preview</a><Link className="text-primary underline" href={`/app/kits/documents/${asset.id}`}>Versions ({asset.currentVersion})</Link></div>
          {canWrite ? <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">Manage</summary><div className="mt-3 grid gap-3"><UploadAssetForm assetId={asset.id} title={asset.title} /><AssetStatusForm assetId={asset.id} status="archived" /></div></details> : null}
        </div>)}</div>
        {canWrite ? <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-primary">Upload a document</summary><div className="mt-4"><UploadAssetForm /></div></details> : null}
      </Card>

      {archivedAssets.length > 0 || canManage ? <Card className="p-6"><h2 className="text-lg font-semibold">Archived documents</h2>
        <p className="mt-1 text-sm text-muted-foreground">Archived documents cannot be added to new packs. Restore one to use it again.</p>
        <div className="mt-4 grid gap-2">{archivedAssets.length === 0 ? <p className="text-sm text-muted-foreground">Nothing archived.</p> : archivedAssets.map((asset) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm" key={asset.id}><div><p className="font-medium">{asset.title}</p><p className="text-xs text-muted-foreground">v{asset.currentVersion} · {kib(asset.byteSize)}{asset.inUse ? " · still used by a pack or case study (kept when purging)" : ""}</p></div>{canWrite ? <AssetStatusForm assetId={asset.id} status="active" /> : null}</div>)}</div>
        {canManage && archivedAssets.length > 0 ? <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-error">Permanently delete archived documents</summary><div className="mt-4"><PurgeForm /></div></details> : null}
      </Card> : null}
      <Card className="p-6"><h2 className="text-lg font-semibold">Case studies</h2>
        <div className="mt-4 grid gap-2">{studies.length === 0 ? <p className="text-sm text-muted-foreground">No case studies yet.</p> : studies.map((study) => <Link className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm hover:border-primary" href={`/app/kits/case-studies/${study.id}`} key={study.id}><span>{study.projectName}</span><span className="text-xs text-muted-foreground">{developmentStatusLabels[study.developmentStatus as DevelopmentStatus]}</span></Link>)}</div>
        {canWrite ? <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-primary">Add a case study</summary><div className="mt-4"><CaseStudyForm /></div></details> : null}
      </Card>

      <Card className="p-6"><h2 className="text-lg font-semibold">Application packs</h2>
        <div className="mt-4 grid gap-2">{packs.length === 0 ? <p className="text-sm text-muted-foreground">No packs yet.</p> : packs.map((pack) => <Link className="rounded-xl border border-border p-3 text-sm hover:border-primary" href={`/app/kits/packs/${pack.id}`} key={pack.id}>
          <div className="flex items-center justify-between gap-3"><span className="font-medium">{pack.title}</span><span className={`rounded-full px-2.5 py-0.5 text-xs capitalize ${pack.status === "approved" ? "bg-success/15 text-success" : "bg-muted"}`}>{pack.status}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{packTemplates[pack.templateKey as PackTemplateKey]?.label ?? pack.templateKey} · for {pack.recipientName}{pack.recipientOrganisation ? `, ${pack.recipientOrganisation}` : ""}</p>
        </Link>)}</div>
        {canWrite && kits.length > 0 ? <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-primary">Create a pack</summary><div className="mt-4"><CreatePackForm assets={assetOptions} caseStudies={studyOptions} kits={kits.map((kit) => ({ id: kit.id, label: kit.name }))} leads={targets.leads} /></div></details> : null}
      </Card>
    </div>
  </main>;
}
