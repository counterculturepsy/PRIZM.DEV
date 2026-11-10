"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";

export function SignupForm() {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setPending(true);
    const data = new FormData(event.currentTarget);
    const credentials = { name: data.get("name"), email: data.get("email"), password: data.get("password") };
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const result = await response.json() as { message?: string; deliveryAvailable?: boolean };
    if (!response.ok) {
      setPending(false);
      setMessage(result.message ?? "Account creation failed. Please try again.");
      return;
    }

    setPending(false);
    setMessage(result.deliveryAvailable
      ? "Check your email for a verification link before signing in."
      : "Your account request was accepted. Verification email delivery is not configured yet; contact the operator for controlled verification.");
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
      <div className="grid gap-2"><Label htmlFor="name">Name</Label><Input autoComplete="name" id="name" maxLength={100} name="name" required /></div>
      <div className="grid gap-2"><Label htmlFor="signup-email">Email address</Label><Input autoComplete="email" id="signup-email" maxLength={320} name="email" required type="email" /></div>
      <div className="grid gap-2"><Label htmlFor="signup-password">Password</Label><Input aria-describedby="password-help" autoComplete="new-password" id="signup-password" maxLength={128} minLength={12} name="password" required type="password" /><p className="text-xs leading-5 text-muted-foreground" id="password-help">At least 12 characters with uppercase, lowercase, and a number.</p></div>
      {message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}
      <Button disabled={pending} type="submit">{pending ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}
