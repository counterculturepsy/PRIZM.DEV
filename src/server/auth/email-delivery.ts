export type AuthEmailDelivery = Readonly<{
  sendVerification(input: Readonly<{ email: string; name: string | null; verificationUrl: string; expiresAt: Date }>): Promise<void>;
  sendPasswordReset(input: Readonly<{ email: string; name: string | null; resetUrl: string; expiresAt: Date }>): Promise<void>;
}>;

/** No external email provider is approved in this release. Routes remain fail-closed until one is injected. */
export function getAuthEmailDelivery(): AuthEmailDelivery | null {
  return null;
}
