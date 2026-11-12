import { getServerEnv } from "@/config/env";
import { accountStatusEmail, passwordResetEmail, pendingRegistrationEmail, verificationEmail, type BrandedEmail } from "./email-templates";

export type AuthEmailDelivery = Readonly<{
  sendVerification(input: Readonly<{ email: string; name: string | null; verificationUrl: string; expiresAt: Date }>): Promise<void>;
  sendPasswordReset(input: Readonly<{ email: string; name: string | null; resetUrl: string; expiresAt: Date }>): Promise<void>;
  sendAccountStatus(input: Readonly<{ email: string; name: string | null; status: "approved" | "rejected" | "suspended" | "reactivated"; loginUrl: string }>): Promise<void>;
  sendPendingRegistration(input: Readonly<{ email: string; name: string | null; adminUrl: string }>): Promise<void>;
}>;

const REQUEST_TIMEOUT_MS = 10_000;

function parseEmailIdentity(value: string): { email: string; name?: string } {
  const match = value.trim().match(/^(?:([^<>]+?)\s*<([^<>]+)>|([^<>\s]+))$/);
  const email = (match?.[2] ?? match?.[3])?.trim();
  if (!email) throw new Error("Transactional email sender configuration is invalid.");
  const name = match?.[1]?.trim();
  return name ? { email, name } : { email };
}

async function sendWithResend(
  apiKey: string,
  from: string,
  replyTo: string | undefined,
  to: string,
  message: BrandedEmail,
): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Transactional email provider rejected the request (${response.status}).`);
}

async function sendWithBrevo(
  apiKey: string,
  from: string,
  replyTo: string | undefined,
  to: string,
  message: BrandedEmail,
): Promise<void> {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: parseEmailIdentity(from),
      to: [{ email: to }],
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== 201) {
    throw new Error(`Transactional email provider rejected the request (${response.status}).`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || !("messageId" in body) || typeof body.messageId !== "string" || !body.messageId.trim()) {
    throw new Error("Transactional email provider returned an invalid response.");
  }
}

export function getAuthEmailDelivery(): AuthEmailDelivery | null {
  const hasEmailConfiguration = [
    process.env.AUTH_EMAIL_PROVIDER,
    process.env.RESEND_API_KEY,
    process.env.BREVO_API_KEY,
    process.env.AUTH_EMAIL_FROM,
    process.env.AUTH_EMAIL_REPLY_TO,
    process.env.ADMIN_NOTIFICATION_EMAIL,
  ].some((value) => Boolean(value?.trim()));
  if (!hasEmailConfiguration) return null;
  const env = getServerEnv();
  const provider = env.AUTH_EMAIL_PROVIDER ?? "resend";
  const providerKey = provider === "brevo" ? env.BREVO_API_KEY : env.RESEND_API_KEY;
  if (!providerKey || !env.AUTH_EMAIL_FROM || !env.ADMIN_NOTIFICATION_EMAIL) {
    throw new Error(`Transactional email provider ${provider} is not completely configured.`);
  }

  const send = provider === "brevo"
    ? (to: string, message: BrandedEmail) => sendWithBrevo(providerKey, env.AUTH_EMAIL_FROM!, env.AUTH_EMAIL_REPLY_TO, to, message)
    : (to: string, message: BrandedEmail) => sendWithResend(providerKey, env.AUTH_EMAIL_FROM!, env.AUTH_EMAIL_REPLY_TO, to, message);

  return {
    sendVerification: (input) => send(input.email, verificationEmail(input)),
    sendPasswordReset: (input) => send(input.email, passwordResetEmail(input)),
    sendAccountStatus: (input) => send(input.email, accountStatusEmail(input)),
    sendPendingRegistration: (input) => send(env.ADMIN_NOTIFICATION_EMAIL!, pendingRegistrationEmail(input)),
  };
}
