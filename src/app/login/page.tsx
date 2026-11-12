import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { CreatorBrand } from "@/components/brand/hoax1g-brand";
import { Logo } from "@/components/brand/logo";
import { getServerEnv } from "@/config/env";
import { LoginActions } from "./login-actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const env = getServerEnv();
  const providers: ("github" | "google")[] = [];
  if (env.OAUTH_LOGIN_ENABLED && env.AUTH_GITHUB_ID && env.AUTH_GITHUB_SECRET) providers.push("github");
  if (env.OAUTH_LOGIN_ENABLED && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) providers.push("google");

  return (
    <AuthShell>
      <div className="flex items-center justify-between gap-4">
        <Logo />
        <CreatorBrand className="hidden sm:inline-flex" showArtwork={false} />
      </div>
        <p className="mt-10 font-mono text-xs uppercase tracking-[0.18em] text-cyan">Secure workspace access</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Sign in to your workspace</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Sign in to access your isolated workspace, opportunity intelligence, and CRM records.</p>
        <div className="mt-8"><LoginActions passwordEnabled={env.PASSWORD_AUTH_ENABLED} providers={providers} /></div>
        {env.PASSWORD_AUTH_ENABLED ? <p className="mt-6 text-sm text-muted-foreground">New to PRIZM.DEV? <Link className="font-medium text-primary hover:underline" href="/signup">Create an account</Link>.</p> : null}
        <p className="mt-8 text-xs leading-5 text-muted-foreground">By continuing, you agree to use business data responsibly and review generated material before external use.</p>
    </AuthShell>
  );
}
