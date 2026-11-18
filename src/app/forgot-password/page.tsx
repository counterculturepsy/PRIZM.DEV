import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { CreatorBrand } from "@/components/brand/hoax1g-brand";
import { Logo } from "@/components/brand/logo";
import { AuthEmailRequestForm } from "@/components/forms/auth-security-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return <AuthShell backHref="/login" backLabel="Back to sign in"><div className="flex items-center justify-between gap-4"><Logo /><CreatorBrand className="hidden sm:inline-flex" showArtwork={false} /></div><p className="mt-10 font-mono text-xs uppercase tracking-[0.18em] text-cyan">Account recovery</p><h1 className="mt-3 text-3xl font-semibold">Reset your password</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Request a single-use link. For privacy, the response is the same whether or not an eligible account exists.</p><div className="mt-8"><AuthEmailRequestForm endpoint="/api/auth/password-reset/request" purpose="password reset" /></div></AuthShell>;
}
