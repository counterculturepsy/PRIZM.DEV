import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { AuthEmailRequestForm, VerifyEmailTokenForm } from "@/components/forms/auth-security-forms";

export const metadata: Metadata = { title: "Verify email" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="page-grid grid min-h-screen place-items-center px-6 py-12"><Card className="w-full max-w-md p-7 sm:p-9"><Logo /><h1 className="mt-10 text-3xl font-semibold">Verify your email</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Verification links expire after 24 hours and can be used only once.</p><div className="mt-8">{token ? <VerifyEmailTokenForm token={token} /> : <AuthEmailRequestForm endpoint="/api/auth/verify-email/request" purpose="verification" />}</div><Link className="mt-6 inline-block text-sm text-primary hover:underline" href="/login">Back to sign in</Link></Card></main>;
}
