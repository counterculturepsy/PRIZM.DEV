import { getServerEnv } from "@/config/env";
import { accountStatusEmail, passwordResetEmail, pendingRegistrationEmail, verificationEmail, type BrandedEmail } from "./email-templates";

export type AuthEmailDelivery = Readonly<{
  sendVerification(input: Readonly<{ email: string; name: string | null; verificationUrl: string; expiresAt: Date }>): Promise<void>;
  sendPasswordReset(input: Readonly<{ email: string; name: string | null; resetUrl: string; expiresAt: Date }>): Promise<void>;
  sendAccountStatus(input: Readonly<{ email: string; name: string | null; status: "approved" | "rejected" | "suspended" | "reactivated"; loginUrl: string }>): Promise<void>;
  sendPendingRegistration(input: Readonly<{ email: string; name: string | null; adminUrl: string }>): Promise<void>;
}>;

export function getAuthEmailDelivery(): AuthEmailDelivery | null {
  const hasEmailConfiguration = [
    process.env.RESEND_API_KEY,
    process.env.AUTH_EMAIL_FROM,
    process.env.ADMIN_NOTIFICATION_EMAIL,
  ].some((value) => Boolean(value?.trim()));
  if (!hasEmailConfiguration) return null;
  const env = getServerEnv();
  if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM || !env.ADMIN_NOTIFICATION_EMAIL) return null;

  const send = async (to: string, message: BrandedEmail) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.AUTH_EMAIL_FROM,
        to: [to],
        ...(env.AUTH_EMAIL_REPLY_TO ? { reply_to: env.AUTH_EMAIL_REPLY_TO } : {}),
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Transactional email provider rejected the request (${response.status}).`);
  };

  return {
    sendVerification: (input) => send(input.email, verificationEmail(input)),
    sendPasswordReset: (input) => send(input.email, passwordResetEmail(input)),
    sendAccountStatus: (input) => send(input.email, accountStatusEmail(input)),
    sendPendingRegistration: (input) => send(env.ADMIN_NOTIFICATION_EMAIL!, pendingRegistrationEmail(input)),
  };
}
