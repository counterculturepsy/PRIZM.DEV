import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { getServerEnv } from "@/config/env";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default function SignupPage() {
  if (!getServerEnv().PASSWORD_AUTH_ENABLED) notFound();
  return (
    <main className="page-grid grid min-h-screen place-items-center px-6 py-12">
      <Card className="w-full max-w-md p-7 sm:p-9">
        <Logo />
        <h1 className="mt-10 text-3xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Create a secure account, then set up your first isolated PRIZM workspace.</p>
        <div className="mt-8"><SignupForm /></div>
        <p className="mt-6 text-sm text-muted-foreground">Already registered? <Link className="font-medium text-primary hover:underline" href="/login">Sign in</Link>.</p>
        <Link className="mt-6 inline-block text-sm text-primary hover:underline" href="/">Back to overview</Link>
      </Card>
    </main>
  );
}
