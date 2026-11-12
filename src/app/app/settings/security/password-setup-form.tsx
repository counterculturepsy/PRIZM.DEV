"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";

export function PasswordSetupForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setPending(true);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/password/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: data.get("password"), confirmation: data.get("confirmation") }),
    });
    const result = await response.json() as { message?: string };
    if (!response.ok) {
      setPending(false);
      setMessage(result.message ?? "Password setup failed.");
      return;
    }
    router.push("/login?password=created");
    router.refresh();
  }
  return <form className="mt-5 grid gap-4" onSubmit={(event) => void submit(event)}>
    <div className="grid gap-2"><Label htmlFor="new-login-password">New password</Label><Input autoComplete="new-password" id="new-login-password" maxLength={128} minLength={12} name="password" required type="password" /></div>
    <div className="grid gap-2"><Label htmlFor="confirm-login-password">Confirm password</Label><Input autoComplete="new-password" id="confirm-login-password" maxLength={128} minLength={12} name="confirmation" required type="password" /></div>
    <p className="text-xs leading-5 text-muted-foreground">Use at least 12 characters with uppercase, lowercase, and a number. Completing setup invalidates the current OAuth session.</p>
    {message ? <p className="text-sm text-error" role="alert">{message}</p> : null}
    <Button disabled={pending} type="submit">{pending ? "Establishing password access…" : "Establish password login"}</Button>
  </form>;
}
