import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { CreatorBrand } from "@/components/brand/hoax1g-brand";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Account pending approval" };

export default async function PendingAccountPage({ searchParams }: { searchParams: Promise<{ verification?: string }> }) {
  const { verification } = await searchParams;
  return (
    <AuthShell backHref="/login" backLabel="Back to sign in">
      <div className="flex items-center justify-between gap-4"><Logo /><CreatorBrand className="hidden sm:inline-flex" showArtwork={false} /></div>
      <p className="mt-10 font-mono text-xs uppercase tracking-[0.18em] text-cyan">Private access request</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Registration received</h1>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">Your account is awaiting administrator approval. Email verification confirms your address but does not grant access.</p>
      <div className="mt-6 rounded-xl border border-border bg-surface-elevated p-4 text-sm text-muted-foreground" role="status">
        {verification === "sent"
          ? "Check your inbox for the verification link. You can sign in after both verification and administrator approval are complete."
          : "Email delivery is not configured in this environment. An administrator can still review the pending request, but controlled email verification is required before password sign-in."}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">Already approved? <Link className="font-medium text-primary hover:underline" href="/login">Return to sign in</Link>.</p>
    </AuthShell>
  );
}
