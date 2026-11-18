"use client";

import { useEffect, useRef, type ComponentProps, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/app/app/actions";

type FieldSnapshot = ReadonlyArray<readonly [string, string]>;

/** Re-applies the submitted values to a form. Hidden, file, password and button controls are left to the markup. */
export function restoreFormValues(form: HTMLFormElement, snapshot: FieldSnapshot): void {
  const byName = new Map<string, string[]>();
  for (const [name, value] of snapshot) byName.set(name, [...(byName.get(name) ?? []), value]);
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    if (!element.name || (element instanceof HTMLInputElement && ["hidden", "file", "submit", "button", "reset", "password"].includes(element.type))) continue;
    const values = byName.get(element.name) ?? [];
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) element.checked = values.includes(element.value);
    else element.value = values[0] ?? "";
  }
}

type RestoringFormProps = Omit<ComponentProps<"form">, "ref"> & { state: FormState };

/**
 * A form that keeps what a person typed when the server rejects it. React 19 resets uncontrolled fields after every
 * form action, which wipes the input even when the action reports an error. This remembers the submitted values and
 * puts them back on an error result. Passwords and files are never remembered.
 */
export function RestoringForm({ state, onSubmit, children, ...formProps }: RestoringFormProps) {
  const formNode = useRef<HTMLFormElement | null>(null);
  const snapshot = useRef<FieldSnapshot>([]);
  const remember = (event: FormEvent<HTMLFormElement>): void => {
    const form = event.currentTarget;
    const secret = new Set(Array.from(form.elements).filter((element): element is HTMLInputElement => element instanceof HTMLInputElement && element.type === "password").map((element) => element.name));
    const entries: Array<readonly [string, string]> = [];
    for (const [name, value] of new FormData(form)) if (typeof value === "string" && !secret.has(name)) entries.push([name, value]);
    snapshot.current = entries;
    onSubmit?.(event);
  };
  useEffect(() => {
    if (state.status === "error" && formNode.current) restoreFormValues(formNode.current, snapshot.current);
  }, [state]);
  return <form {...formProps} onSubmit={remember} ref={formNode}>{children}</form>;
}

export function SubmitButton({ children, pendingLabel = "Saving…" }: { children: React.ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <Button disabled={pending} type="submit">{pending ? pendingLabel : children}</Button>;
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <p aria-live="polite" className={state.status === "error" ? "text-sm text-error" : "text-sm text-success"} role={state.status === "error" ? "alert" : "status"}>
      {state.message}
    </p>
  );
}
