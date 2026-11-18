import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Hoax1gArtwork } from "@/components/brand/hoax1g-brand";
import { Hoax1gMotion } from "@/components/brand/hoax1g-motion";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";

export function AuthShell({ children, backHref = "/", backLabel = "Back to overview" }: { children: React.ReactNode; backHref?: string; backLabel?: string }) {
  return (
    <main className="page-grid relative min-h-screen overflow-hidden px-4 py-4 sm:px-6 sm:py-6 lg:grid lg:grid-cols-[minmax(380px,0.92fr)_minmax(520px,1.08fr)] lg:gap-6">
      <div aria-hidden="true" className="brand-orb brand-orb-primary -left-40 -top-40" />
      <div aria-hidden="true" className="brand-orb brand-orb-cyan -bottom-48 -right-36" />

      <section aria-label="HOAX1G.DEV creator identity" className="relative hidden min-h-[calc(100vh-3rem)] overflow-hidden rounded-[2rem] border border-border/80 bg-card/70 p-5 shadow-[var(--shadow-elevated)] lg:flex lg:flex-col">
        <div className="flex items-center justify-between gap-4 px-1">
          <Logo />
          <span className="brand-eyebrow">A HOAX1G.DEV product</span>
        </div>
        <Hoax1gMotion className="mx-auto my-auto aspect-[1280/1134] w-full max-w-[720px] rounded-[1.5rem]" priority sizes="(min-width: 1024px) 48vw, 100vw" />
        <div className="flex items-center justify-between gap-5 px-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-cyan" />Secure workspace intelligence</span>
          <span className="font-mono uppercase tracking-[0.16em]">Code · Create · Innovate</span>
        </div>
      </section>

      <section className="relative flex min-h-[calc(100vh-2rem)] items-center justify-center py-6 sm:min-h-[calc(100vh-3rem)] lg:py-10">
        <div className="w-full max-w-xl">
          <div className="mb-5 flex items-center justify-between gap-4 lg:hidden">
            <Logo />
            <span className="brand-eyebrow">By HOAX1G.DEV</span>
          </div>
          <Card className="surface-glow overflow-hidden p-6 sm:p-9">
            <div className="mb-7 overflow-hidden rounded-2xl border border-border/80 bg-background lg:hidden">
              <Hoax1gArtwork className="aspect-[16/7] w-full [&_img]:object-cover [&_img]:object-[50%_58%]" priority />
            </div>
            {children}
          </Card>
          <Link className="brand-link mx-auto mt-5 flex w-fit items-center gap-2 text-sm" href={backHref}>
            <ArrowLeft aria-hidden="true" className="size-4" />{backLabel}
          </Link>
        </div>
      </section>
    </main>
  );
}
