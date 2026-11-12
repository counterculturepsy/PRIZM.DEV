import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { CreatorBrand } from "@/components/brand/hoax1g-brand";
import { Logo } from "@/components/brand/logo";
import { AuthEmailRequestForm, VerifyEmailTokenForm } from "@/components/forms/auth-security-forms";

export const metadata: Metadata = { title: "Verify email" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AuthShell backHref="/login" backLabel="Back to sign in"><div className="flex items-center justify-between gap-4"><Logo /><CreatorBrand className="hidden sm:inline-flex" showArtwork={false} /></div><p className="mt-10 font-mono text-xs uppercase tracking-[0.18em] text-cyan">Identity verification</p><h1 className="mt-3 text-3xl font-semibold">Verify your email</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Verification links expire after 24 hours and can be used only once.</p><div className="mt-8">{token ? <VerifyEmailTokenForm token={token} /> : <AuthEmailRequestForm endpoint="/api/auth/verify-email/request" purpose="verification" />}</div></AuthShell>;
}
