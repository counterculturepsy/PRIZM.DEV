import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useActionState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/app/app/actions";
import { RestoringForm, restoreFormValues } from "@/components/forms/form-parts";

afterEach(cleanup);

describe("restoreFormValues", () => {
  it("puts text, select and checkbox values back and leaves hidden, file and password controls alone", () => {
    const form = document.createElement("form");
    form.innerHTML = `
      <input name="title" />
      <textarea name="note"></textarea>
      <select name="kind"><option value="a">A</option><option value="b">B</option></select>
      <input name="pick" type="checkbox" value="one" />
      <input name="pick" type="checkbox" value="two" />
      <input name="token" type="hidden" value="server-value" />
      <input name="secret" type="password" />`;
    restoreFormValues(form, [["title", "Kept title"], ["note", "Kept note"], ["kind", "b"], ["pick", "two"], ["token", "typed"], ["secret", "typed"]]);
    expect((form.elements.namedItem("title") as HTMLInputElement).value).toBe("Kept title");
    expect((form.elements.namedItem("note") as HTMLTextAreaElement).value).toBe("Kept note");
    expect((form.elements.namedItem("kind") as HTMLSelectElement).value).toBe("b");
    const picks = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="pick"]'));
    expect(picks.map((box) => box.checked)).toEqual([false, true]);
    expect((form.elements.namedItem("token") as HTMLInputElement).value).toBe("server-value");
    expect((form.elements.namedItem("secret") as HTMLInputElement).value).toBe("");
  });
});

function Harness({ outcome }: { outcome: "error" | "success" }) {
  const [state, action] = useActionState(async (): Promise<FormState> => ({ status: outcome, message: `outcome:${outcome}` }), { status: "idle" } as FormState);
  return (
    <RestoringForm action={action} state={state}>
      <label htmlFor="title">Title</label>
      <input id="title" name="title" />
      <label htmlFor="secret">Secret</label>
      <input id="secret" name="secret" type="password" />
      <button type="submit">Send</button>
      <p>{state.message}</p>
    </RestoringForm>
  );
}

describe("RestoringForm", () => {
  it("keeps what was typed when the action reports an error, and never restores a password", async () => {
    render(<Harness outcome="error" />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Typed title" } });
    fireEvent.change(screen.getByLabelText("Secret"), { target: { value: "Hunter2-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("outcome:error");
    await vi.waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Typed title"));
    expect((screen.getByLabelText("Secret") as HTMLInputElement).value).toBe("");
  });

  it("lets the form reset normally after a successful action", async () => {
    render(<Harness outcome="success" />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Typed title" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("outcome:success");
    await vi.waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(""));
  });
});
