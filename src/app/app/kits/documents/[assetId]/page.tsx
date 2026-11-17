import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { AssetStatusForm, UploadAssetForm } from "@/components/forms/kit-forms";
import { Card } from "@/components/ui/card";
import { hasCapability } from "@/modules/workspaces/scope";
import { UUID_PATTERN } from "@/server/kits/http";
import { getKitAsset, listKitAssetVersions } from "@/server/kits/library";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Document versions" };

const size = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

export default async function DocumentPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { scope } = await getWorkspaceContext("read");
  const { assetId } = await params;
  if (!UUID_PATTERN.test(assetId)) notFound();
  const [asset, versions] = await Promise.all([getKitAsset(scope, assetId), listKitAssetVersions(scope, assetId)]);
  if (!asset) notFound();
  const canWrite = hasCapability(scope, "write");
  return <main className="mx-auto max-w-4xl px-5 py-10 sm:px-6 lg:px-8">
    <Link className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground" href="/app/kits"><ArrowLeft className="mr-2 size-4" />Back to capability kits</Link>
    <div className="mt-7 flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">{asset.kind === "pdf" ? "PDF document" : "Image"} · current version {asset.currentVersion}</p><h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{asset.title}</h1></div><span className="rounded-full bg-primary/10 px-3 py-1.5 text-sm capitalize text-primary">{asset.status}</span></div>
    <p className="mt-3 text-sm text-muted-foreground">Versions are immutable: uploading a new file adds a version and never changes an earlier one. Packs keep the version that was approved.</p>

    <Card className="mt-8 p-6"><h2 className="text-lg font-semibold">Versions</h2>
      <div className="mt-4 grid gap-3">{versions.map((version) => <article className="rounded-xl border border-border p-4 text-sm" key={version.version}>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Version {version.version}{version.version === asset.currentVersion ? <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">Current</span> : null}</span><span className="font-mono text-xs text-muted-foreground">{size(version.byteSize)}{version.pageCount ? ` · ${version.pageCount} pp` : ""}</span></div>
        <p className="mt-1 text-xs text-muted-foreground">{version.filename} · uploaded {version.createdAt.toLocaleString("en-ZA")} · SHA-256 {version.sha256.slice(0, 12)}…</p>
        <div className="mt-2 flex flex-wrap gap-4 text-xs"><a className="text-primary underline" href={`/api/kits/assets/${asset.id}?version=${version.version}`}>Download</a><a className="text-primary underline" href={`/api/kits/assets/${asset.id}?version=${version.version}&inline=1`} rel="noreferrer" target="_blank">Preview</a></div>
      </article>)}</div>
    </Card>

    {canWrite ? <div className="mt-6 grid gap-6 md:grid-cols-2">
      {asset.status === "active" ? <Card className="p-6"><h2 className="text-lg font-semibold">Upload a new version</h2><div className="mt-4"><UploadAssetForm assetId={asset.id} title={asset.title} /></div></Card> : null}
      <Card className="p-6"><h2 className="text-lg font-semibold">{asset.status === "active" ? "Archive" : "Restore"}</h2><p className="mt-2 text-sm text-muted-foreground">{asset.status === "active" ? "Archived documents cannot be added to new packs." : "Restore this document to use it again."}</p><div className="mt-4"><AssetStatusForm assetId={asset.id} status={asset.status === "active" ? "archived" : "active"} /></div></Card>
    </div> : null}
  </main>;
}
