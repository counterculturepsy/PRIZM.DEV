"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";

export function LoginActions({ passwordEnabled, providers }: { passwordEnabled: boolean; providers: readonly ("github" | "google")[] }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setPending(true);
    const data = new FormData(event.currentTarget);
    const result = await signIn("credentials", {
      email: data.get("email"),
      password: data.get("password"),
      callbackUrl: "/app",
      redirect: false,
    });
    setPending(false);
    if (!result?.ok) {
      setMessage("The email address or password is incorrect.");
      return;
    }
    window.location.assign(result.url ?? "/app");
  }

  return (
    <div className="grid gap-5">
      {passwordEnabled ? (
        <form className="grid gap-4" onSubmit={(event) => void login(event)}>
          <div className="grid gap-2"><Label htmlFor="email">Email address</Label><Input autoComplete="email" id="email" name="email" required type="email" /></div>
          <div className="grid gap-2"><Label htmlFor="password">Password</Label><Input autoComplete="current-password" id="password" maxLength={128} name="password" required type="password" /></div>
          {message ? <p aria-live="polite" className="text-sm text-error" role="alert">{message}</p> : null}
          <Button disabled={pending} type="submit">{pending ? "Signing in…" : "Sign in"}</Button>
          <div className="flex flex-wrap justify-between gap-3 text-sm"><Link className="text-primary hover:underline" href="/forgot-password">Forgot password?</Link><Link className="text-primary hover:underline" href="/verify-email">Verify email</Link></div>
        </form>
      ) : null}
      {passwordEnabled && providers.length > 0 ? <div className="flex items-center gap-3 text-xs uppercase tracking-[0.16em] text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>or</span><span className="h-px flex-1 bg-border" /></div> : null}
      {providers.map((provider) => (
        <Button className="w-full" key={provider} onClick={() => void signIn(provider, { callbackUrl: "/app" })} variant="secondary">
          Continue with {provider === "github" ? "GitHub" : "Google"}
        </Button>
      ))}
      {!passwordEnabled && providers.length === 0 ? <p className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">No sign-in method is configured.</p> : null}
    </div>
  );
}
