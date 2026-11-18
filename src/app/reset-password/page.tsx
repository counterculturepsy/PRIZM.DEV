import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { CreatorBrand } from "@/components/brand/hoax1g-brand";
import { Logo } from "@/components/brand/logo";
import { ResetPasswordForm } from "@/components/forms/auth-security-forms";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AuthShell backHref="/login" backLabel="Back to sign in"><div className="flex items-center justify-between gap-4"><Logo /><CreatorBrand className="hidden sm:inline-flex" showArtwork={false} /></div><p className="mt-10 font-mono text-xs uppercase tracking-[0.18em] text-cyan">Secure credential update</p><h1 className="mt-3 text-3xl font-semibold">Choose a new password</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Reset links expire after 30 minutes and are invalidated after one use.</p><div className="mt-8">{token ? <ResetPasswordForm token={token} /> : <p className="text-sm text-error">The reset link is missing or invalid.</p>}</div></AuthShell>;
}
