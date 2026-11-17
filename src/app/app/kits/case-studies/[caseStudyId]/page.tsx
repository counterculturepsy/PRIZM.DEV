import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { CaseStudyForm, CaseStudyStatusForm } from "@/components/forms/kit-forms";
import { Card } from "@/components/ui/card";
import { hasCapability } from "@/modules/workspaces/scope";
import { UUID_PATTERN } from "@/server/kits/http";
import { listCaseStudies, listCaseStudyScreenshots, listKitAssets } from "@/server/kits/library";
import { getWorkspaceContext } from "@/server/workspaces/context";

export const metadata: Metadata = { title: "Case study" };

export default async function CaseStudyPage({ params }: { params: Promise<{ caseStudyId: string }> }) {
  const { scope } = await getWorkspaceContext("read");
  const { caseStudyId } = await params;
  if (!UUID_PATTERN.test(caseStudyId)) notFound();
  const [studies, assets, screenshots] = await Promise.all([listCaseStudies(scope, { includeArchived: true }), listKitAssets(scope), listCaseStudyScreenshots(scope, caseStudyId)]);
  const study = studies.find((entry) => entry.id === caseStudyId);
  if (!study) notFound();
  const canWrite = hasCapability(scope, "write");
  const images = assets.filter((asset) => asset.kind === "image").map((asset) => ({ id: asset.id, label: asset.title }));
  return <main className="mx-auto max-w-4xl px-5 py-10 sm:px-6 lg:px-8">
    <Link className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground" href="/app/kits"><ArrowLeft className="mr-2 size-4" />Back to capability kits</Link>
    <h1 className="mt-7 text-3xl font-semibold sm:text-4xl">{study.projectName}</h1>
    <p className="mt-2 text-sm capitalize text-muted-foreground">{study.status}</p>
    <Card className="mt-8 p-6">{canWrite && study.status === "active"
      ? <CaseStudyForm images={images} selectedImageIds={screenshots.map((shot) => shot.assetId)} study={study} />
      : <p className="text-sm text-muted-foreground">{study.status === "archived" ? "Restore this case study to edit it." : "Your workspace role can view this case study but not change it."}</p>}</Card>
    {canWrite ? <Card className="mt-6 p-6"><h2 className="text-lg font-semibold">Archive</h2><p className="mt-2 text-sm text-muted-foreground">Archived case studies cannot be added to new packs.</p><div className="mt-4"><CaseStudyStatusForm caseStudyId={study.id} status={study.status === "active" ? "archived" : "active"} /></div></Card> : null}
  </main>;
}
