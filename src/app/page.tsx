import Link from "next/link";
import { ArrowRight, Crosshair, FileText, Radar, ScanSearch, ShieldCheck, Sparkles } from "lucide-react";
import { CreatorBrand } from "@/components/brand/hoax1g-brand";
import { Hoax1gMotion } from "@/components/brand/hoax1g-motion";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

const features = [
  { icon: Radar, title: "Opportunity discovery", copy: "Find businesses with attributable digital opportunity signals, not an undifferentiated list." },
  { icon: ScanSearch, title: "Evidence-led audits", copy: "Keep observations, sources, confidence, and recommendations visibly separate." },
  { icon: Crosshair, title: "Transparent scoring", copy: "Understand why a prospect deserves attention before investing sales time." },
  { icon: Sparkles, title: "Grounded sales drafts", copy: "Generate strategy and outreach from real evidence with human review by default." },
  { icon: FileText, title: "Proposal workflow", copy: "Turn a validated opportunity into scoped, reviewable commercial work." },
  { icon: ShieldCheck, title: "Workspace safe", copy: "Tenant isolation and role authorization are architecture requirements, not later add-ons." },
] as const;

export default function HomePage() {
  return (
    <main className="page-grid min-h-screen overflow-hidden">
      <nav aria-label="Primary" className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
        <Logo />
        <div className="flex items-center gap-4"><CreatorBrand className="hidden md:inline-flex" showArtwork={false} /><Link className={buttonVariants({ variant: "secondary" })} href="/login">Sign in</Link></div>
      </nav>

      <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 pb-24 pt-14 lg:grid-cols-[minmax(0,1.06fr)_minmax(380px,0.94fr)] lg:px-8 lg:pb-32 lg:pt-20">
        <div aria-hidden="true" className="absolute left-1/3 top-0 -z-10 h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-primary/15 blur-[120px]" />
        <div className="max-w-4xl">
          <p className="mb-6 inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-cyan">Client acquisition intelligence · South Africa first</p>
          <h1 className="text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl">Find your next client <span className="bg-gradient-to-r from-primary via-magenta to-cyan bg-clip-text text-transparent">before your competition does.</span></h1>
          <p className="mt-8 max-w-2xl text-pretty text-lg leading-8 text-muted-foreground sm:text-xl">PRIZM.DEV is being built to discover businesses with real digital opportunities, explain the evidence, and help teams turn qualified prospects into clients.</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link className={buttonVariants({ variant: "primary" })} href="/login">Enter PRIZM.DEV <ArrowRight aria-hidden="true" className="ml-2 size-4" /></Link>
            <a className={buttonVariants({ variant: "ghost" })} href="#capabilities">Explore the architecture</a>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-xl">
          <div aria-hidden="true" className="absolute -inset-8 rounded-full bg-[conic-gradient(from_180deg,rgba(160,32,240,0.22),rgba(0,217,255,0.1),transparent,rgba(160,32,240,0.18))] blur-3xl" />
          <Hoax1gMotion className="relative aspect-[1280/1134] w-full rounded-[2rem] border border-primary/25 shadow-[var(--shadow-elevated)]" priority sizes="(min-width: 1024px) 520px, 90vw" />
          <div className="absolute -bottom-5 left-1/2 flex w-[88%] -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-border bg-surface-elevated/95 px-4 py-3 shadow-[var(--shadow-elevated)] backdrop-blur">
            <CreatorBrand />
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground sm:block">Official creator identity</span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-24 lg:px-8" id="capabilities">
        <div className="mb-10 max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">Built around better opportunities</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">A serious operating system, developed in deliberate milestones.</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, copy }) => (
            <Card className="group p-6 transition-[border-color,background-color,transform] duration-200 hover:border-primary/45 hover:bg-surface-elevated motion-safe:hover:-translate-y-1" key={title}>
              <Icon aria-hidden="true" className="size-5 text-primary" />
              <h3 className="mt-5 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
            </Card>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8"><div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 text-center text-sm text-muted-foreground sm:flex-row sm:text-left"><p className="max-w-4xl">PRIZM.DEV client acquisition platform. Controlled discovery, audits, opportunity scoring, tenant-safe CRM, review-only AI drafts, versioned proposals, campaign safety, and workspace-scoped reporting are implemented; live providers, outbound automation, and recognized-revenue reporting remain disabled.</p><CreatorBrand className="shrink-0" /></div></footer>
    </main>
  );
}
