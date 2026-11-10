import { isIP } from "node:net";
import { getServerEnv } from "@/config/env";

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

export class UntrustedMutationOriginError extends Error {
  constructor() {
    super("The request origin is not allowed.");
    this.name = "UntrustedMutationOriginError";
  }
}

function readHeader(source: HeaderSource, name: string): string | null {
  if (source instanceof Headers) return source.get(name);
  const value = source[name] ?? source[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function assertTrustedMutationOrigin(request: Request, expectedOrigin = new URL(getServerEnv().NEXTAUTH_URL).origin): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new UntrustedMutationOriginError();
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    throw new UntrustedMutationOriginError();
  }
  if (normalized !== expectedOrigin) throw new UntrustedMutationOriginError();
}

export function trustedClientIp(
  source: HeaderSource,
  runtime: Readonly<{ isVercel: boolean }> = { isVercel: process.env.VERCEL === "1" },
): string | null {
  if (!runtime.isVercel) return null;
  const candidate = readHeader(source, "x-vercel-forwarded-for")?.trim();
  if (!candidate || candidate.includes(",") || isIP(candidate) === 0) return null;
  return candidate;
}
