import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/forms/auth-security-forms";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="page-grid grid min-h-screen place-items-center px-6 py-12"><Card className="w-full max-w-md p-7 sm:p-9"><Logo /><h1 className="mt-10 text-3xl font-semibold">Choose a new password</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Reset links expire after 30 minutes and are invalidated after one use.</p><div className="mt-8">{token ? <ResetPasswordForm token={token} /> : <p className="text-sm text-error">The reset link is missing or invalid.</p>}</div><Link className="mt-6 inline-block text-sm text-primary hover:underline" href="/login">Back to sign in</Link></Card></main>;
}
