import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { loginSchema } from "@/modules/auth/validation";
import { recordAuthSecurityEvent } from "@/server/auth/events";
import { authOptions } from "@/server/auth/options";
import { consumeRequestLimits } from "@/server/auth/route-security";

const handler = NextAuth(authOptions);

export { handler as GET };

export async function POST(request: NextRequest, context: unknown) {
  if (!request.nextUrl.pathname.endsWith("/callback/credentials")) {
    return handler(request, context);
  }

  const parsed = loginSchema.safeParse(Object.fromEntries(await request.clone().formData()));
  if (!parsed.success) return handler(request, context);

  const limit = await consumeRequestLimits(request, parsed.data.email, "login", "login_ip");
  if (!limit.allowed) {
    await recordAuthSecurityEvent({
      eventType: "login",
      outcome: "rate_limited",
      identifier: parsed.data.email,
      clientIp: limit.clientIp,
    });
    return NextResponse.json(
      { url: new URL("/login?error=CredentialsSignin", request.url).toString() },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(limit.retryAfterSeconds),
        },
      },
    );
  }

  return handler(request, context);
}
