import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { KitForm, KitStatusForm } from "@/components/forms/kit-forms";
import { Card } from "@/components/ui/card";
import { developmentStatusLabels, type DevelopmentStatus } from "@/modules/kits/content";
import { hasCapability } from "@/modules/workspaces/scope";
import { UUID_PATTERN } from "@/server/kits/http";
import { getCapabilityKit, listCaseStudies, listKitAssets } from "@/server/kits/library";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Capability kit" };

export default async function KitPage({ params }: { params: Promise<{ kitId: string }> }) {
  const { scope } = await getWorkspaceContext("read");
  const { kitId } = await params;
  if (!UUID_PATTERN.test(kitId)) notFound();
  const [loaded, studies, assets] = await Promise.all([getCapabilityKit(scope, kitId), listCaseStudies(scope), listKitAssets(scope)]);
  if (!loaded?.content) notFound();
  const canWrite = hasCapability(scope, "write");
  const { kit, content, versions } = loaded;
  return <main className="mx-auto max-w-5xl px-5 py-10 sm:px-6 lg:px-8">
    <Link className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground" href="/app/kits"><ArrowLeft className="mr-2 size-4" />Back to capability kits</Link>
    <div className="mt-7 flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Capability kit · version {kit.currentVersion}</p><h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{kit.name}</h1></div><span className="rounded-full bg-primary/10 px-3 py-1.5 text-sm capitalize text-primary">{kit.status}</span></div>
    <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_0.8fr]">
      <Card className="p-6">{canWrite && kit.status === "active"
        ? <KitForm assets={assets.map((asset) => ({ id: asset.id, label: `${asset.title} · ${asset.kind}` }))} caseStudies={studies.map((study) => ({ id: study.id, label: `${study.projectName} (${developmentStatusLabels[study.developmentStatus as DevelopmentStatus]})` }))} content={content} kit={{ id: kit.id, name: kit.name, currentVersion: kit.currentVersion }} />
        : <p className="text-sm text-muted-foreground">{kit.status === "archived" ? "Restore this kit to edit it." : "Your workspace role can view this kit but not change it."}</p>}</Card>
      <div className="grid content-start gap-6">
        <Card className="p-6"><h2 className="text-lg font-semibold">Version history</h2><div className="mt-4 grid gap-3">{versions.map((version) => <div className="border-l border-border pl-4" key={version.version}><p className="text-sm">Version {version.version}{version.changeNote ? ` — ${version.changeNote}` : ""}</p><p className="mt-1 text-xs text-muted-foreground">{version.createdAt.toLocaleString("en-ZA")}</p></div>)}</div></Card>
        {canWrite ? <Card className="p-6"><h2 className="text-lg font-semibold">Archive</h2><p className="mt-2 text-sm text-muted-foreground">Archived kits cannot be edited or used for new packs. Existing packs keep the version they were approved with.</p><div className="mt-4"><KitStatusForm kitId={kit.id} status={kit.status === "active" ? "archived" : "active"} /></div></Card> : null}
      </div>
    </div>
  </main>;
}
