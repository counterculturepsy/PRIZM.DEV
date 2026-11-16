import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { CreatorBrand } from "@/components/brand/hoax1g-brand";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Account pending approval" };

export default function PendingAccountPage() {
  return (
    <AuthShell backHref="/login" backLabel="Back to sign in">
      <div className="flex items-center justify-between gap-4"><Logo /><CreatorBrand className="hidden sm:inline-flex" showArtwork={false} /></div>
      <p className="mt-10 font-mono text-xs uppercase tracking-[0.18em] text-cyan">Private access request</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Verification request received</h1>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">Your account is awaiting administrator approval. Email verification confirms your address but does not grant access.</p>
      <div className="mt-6 rounded-xl border border-border bg-surface-elevated p-4 text-sm text-muted-foreground" role="status">
        If your account requires verification, you may receive an email with further instructions. Please check your inbox and spam folder. If nothing arrives after 10 minutes, you can request another link.
      </div>
      <p className="mt-6 text-sm text-muted-foreground">Already approved? <Link className="font-medium text-primary hover:underline" href="/login">Return to sign in</Link>.</p>
    </AuthShell>
  );
}
