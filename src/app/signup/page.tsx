import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { CreatorBrand } from "@/components/brand/hoax1g-brand";
import { Logo } from "@/components/brand/logo";
import { getServerEnv } from "@/config/env";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default function SignupPage() {
  if (!getServerEnv().PASSWORD_AUTH_ENABLED) notFound();
  return (
    <AuthShell backHref="/login" backLabel="Back to sign in">
      <div className="flex items-center justify-between gap-4"><Logo /><CreatorBrand className="hidden sm:inline-flex" showArtwork={false} /></div>
        <p className="mt-10 font-mono text-xs uppercase tracking-[0.18em] text-cyan">Start securely</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Create your account</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Create a secure account, then set up your first isolated PRIZM workspace.</p>
        <div className="mt-8"><SignupForm /></div>
        <p className="mt-6 text-sm text-muted-foreground">Already registered? <Link className="font-medium text-primary hover:underline" href="/login">Sign in</Link>.</p>
    </AuthShell>
  );
}
