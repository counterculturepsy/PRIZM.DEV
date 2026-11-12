type BrandedEmail = Readonly<{ subject: string; html: string; text: string }>;

const productName = "PRIZM.DEV";
const creatorName = "HOAX1G.DEV";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayName(name: string | null): string {
  return name?.trim() ? name.trim() : "there";
}

function layout(input: Readonly<{ preview: string; heading: string; body: string; text: string; action?: Readonly<{ label: string; url: string }> }>): Omit<BrandedEmail, "subject"> {
  const action = input.action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;border-radius:10px;background:linear-gradient(135deg,#A020F0,#00D9FF);color:#07040F;font-weight:700;padding:13px 20px;text-decoration:none">${escapeHtml(input.action.label)}</a></p><p style="color:#A6A0BA;font-size:13px;line-height:1.6;overflow-wrap:anywhere">If the button does not work, copy this link:<br>${escapeHtml(input.action.url)}</p>`
    : "";
  return {
    html: `<!doctype html><html><body style="margin:0;background:#07040F;color:#F5F3FF;font-family:Inter,Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preview)}</div><div style="margin:0 auto;max-width:620px;padding:40px 20px"><div style="border:1px solid #332A50;border-radius:18px;background:#141025;padding:32px"><p style="margin:0 0 24px;color:#00D9FF;font-family:monospace;font-size:12px;letter-spacing:.18em">${productName} · BY ${creatorName}</p><h1 style="margin:0 0 18px;font-size:28px;line-height:1.2">${escapeHtml(input.heading)}</h1><div style="color:#D8D4E5;font-size:15px;line-height:1.7">${input.body}</div>${action}<p style="margin:30px 0 0;border-top:1px solid #332A50;padding-top:20px;color:#A6A0BA;font-size:12px;line-height:1.6">This is a security message from ${productName}. Never share passwords or authentication links.</p></div></div></body></html>`,
    text: `${productName} · by ${creatorName}\n\n${input.heading}\n\n${input.text}${input.action ? `\n\n${input.action.label}: ${input.action.url}` : ""}\n\nThis is a security message from ${productName}. Never share passwords or authentication links.`,
  };
}

export function verificationEmail(input: Readonly<{ name: string | null; verificationUrl: string; expiresAt: Date }>): BrandedEmail {
  const expires = input.expiresAt.toISOString();
  return {
    subject: `Verify your ${productName} email`,
    ...layout({
      preview: `Verify your email address for ${productName}.`,
      heading: "Verify your email",
      body: `<p>Hello ${escapeHtml(displayName(input.name))},</p><p>Confirm this address to continue your private-access request. Verification does not approve the account; an administrator must still review it.</p><p style="color:#A6A0BA">This single-use link expires at ${escapeHtml(expires)}.</p>`,
      text: `Hello ${displayName(input.name)},\n\nConfirm this address to continue your private-access request. Verification does not approve the account; an administrator must still review it.\n\nThis single-use link expires at ${expires}.`,
      action: { label: "Verify email", url: input.verificationUrl },
    }),
  };
}

export function passwordResetEmail(input: Readonly<{ name: string | null; resetUrl: string; expiresAt: Date }>): BrandedEmail {
  const expires = input.expiresAt.toISOString();
  return {
    subject: `Reset your ${productName} password`,
    ...layout({
      preview: `Reset your ${productName} password.`,
      heading: "Reset your password",
      body: `<p>Hello ${escapeHtml(displayName(input.name))},</p><p>A password reset was requested for your account. If this was not you, ignore this email and your password will remain unchanged.</p><p style="color:#A6A0BA">This single-use link expires at ${escapeHtml(expires)}.</p>`,
      text: `Hello ${displayName(input.name)},\n\nA password reset was requested for your account. If this was not you, ignore this email and your password will remain unchanged.\n\nThis single-use link expires at ${expires}.`,
      action: { label: "Reset password", url: input.resetUrl },
    }),
  };
}

export function accountStatusEmail(input: Readonly<{ name: string | null; status: "approved" | "rejected" | "suspended" | "reactivated"; loginUrl: string }>): BrandedEmail {
  const copy = {
    approved: { subject: "Your PRIZM.DEV account was approved", heading: "Account approved", message: "Your verified account has been approved. You can now sign in." },
    rejected: { subject: "Your PRIZM.DEV access request was not approved", heading: "Access request reviewed", message: "Your private-access request was reviewed and was not approved. Contact the project administrator if you believe this is an error." },
    suspended: { subject: "Your PRIZM.DEV account was suspended", heading: "Account suspended", message: "Access to your account has been suspended. Existing sessions are no longer valid." },
    reactivated: { subject: "Your PRIZM.DEV account was reactivated", heading: "Account reactivated", message: "Access to your account has been restored. You can sign in again." },
  }[input.status];
  return {
    subject: copy.subject,
    ...layout({
      preview: copy.message,
      heading: copy.heading,
      body: `<p>Hello ${escapeHtml(displayName(input.name))},</p><p>${escapeHtml(copy.message)}</p>`,
      text: `Hello ${displayName(input.name)},\n\n${copy.message}`,
      ...(input.status === "approved" || input.status === "reactivated"
        ? { action: { label: "Open sign in", url: input.loginUrl } }
        : {}),
    }),
  };
}

export function pendingRegistrationEmail(input: Readonly<{ name: string | null; email: string; adminUrl: string }>): BrandedEmail {
  return {
    subject: `New ${productName} registration awaiting review`,
    ...layout({
      preview: "A new private-access request is awaiting administrator review.",
      heading: "New registration pending",
      body: `<p>A new private-access request was received.</p><p><strong>Name:</strong> ${escapeHtml(input.name?.trim() || "Not supplied")}<br><strong>Email:</strong> ${escapeHtml(input.email)}</p><p>Verify the email indicator before approving access.</p>`,
      text: `A new private-access request was received.\n\nName: ${input.name?.trim() || "Not supplied"}\nEmail: ${input.email}\n\nVerify the email indicator before approving access.`,
      action: { label: "Review registrations", url: input.adminUrl },
    }),
  };
}

export type { BrandedEmail };
