"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";

export function AuthEmailRequestForm({ endpoint, purpose }: { endpoint: string; purpose: "verification" | "password reset" }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const email = new FormData(event.currentTarget).get("email");
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const result = await response.json() as { message?: string; deliveryAvailable?: boolean };
    setPending(false);
    if (!response.ok) return setMessage(result.message ?? "The request could not be completed.");
    setMessage(result.deliveryAvailable
      ? `If the account is eligible, a ${purpose} link has been sent.`
      : `The request was accepted, but external email delivery is not configured. No ${purpose} email was sent.`);
  }
  return <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
    <div className="grid gap-2"><Label htmlFor={`${purpose}-email`}>Email address</Label><Input autoComplete="email" id={`${purpose}-email`} name="email" required type="email" /></div>
    {message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}
    <Button disabled={pending} type="submit">{pending ? "Submitting…" : `Request ${purpose}`}</Button>
  </form>;
}

export function VerifyEmailTokenForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function verify() {
    setPending(true);
    const response = await fetch("/api/auth/verify-email/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const result = await response.json() as { message?: string };
    setPending(false);
    setMessage(response.ok ? "Email verified. You can now sign in." : result.message ?? "Verification failed.");
  }
  return <div className="grid gap-4">{message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}<Button disabled={pending} onClick={() => void verify()}>{pending ? "Verifying…" : "Verify email"}</Button></div>;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const password = new FormData(event.currentTarget).get("password");
    const response = await fetch("/api/auth/password-reset/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    const result = await response.json() as { message?: string };
    setPending(false);
    setMessage(response.ok ? "Password reset. Existing sessions were invalidated; sign in again." : result.message ?? "Password reset failed.");
  }
  return <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
    <div className="grid gap-2"><Label htmlFor="new-password">New password</Label><Input autoComplete="new-password" id="new-password" maxLength={128} minLength={12} name="password" required type="password" /><p className="text-xs text-muted-foreground">At least 12 characters with uppercase, lowercase, and a number.</p></div>
    {message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}
    <Button disabled={pending} type="submit">{pending ? "Resetting…" : "Reset password"}</Button>
  </form>;
}
