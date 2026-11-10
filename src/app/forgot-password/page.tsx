import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { AuthEmailRequestForm } from "@/components/forms/auth-security-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return <main className="page-grid grid min-h-screen place-items-center px-6 py-12"><Card className="w-full max-w-md p-7 sm:p-9"><Logo /><h1 className="mt-10 text-3xl font-semibold">Reset your password</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Request a single-use link. For privacy, the response is the same whether or not an eligible account exists.</p><div className="mt-8"><AuthEmailRequestForm endpoint="/api/auth/password-reset/request" purpose="password reset" /></div><Link className="mt-6 inline-block text-sm text-primary hover:underline" href="/login">Back to sign in</Link></Card></main>;
}
