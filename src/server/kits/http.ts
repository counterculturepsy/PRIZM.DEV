import { createHmac } from "node:crypto";
import { getServerEnv } from "@/config/env";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
} as const;

/** Serves private bytes. Never public, never cacheable, never sniffable, and the name is re-sanitised for the header. */
export function downloadResponse(input: { bytes: Uint8Array; filename: string; contentType: string; inline: boolean }): Response {
  const safeName = input.filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "document";
  const body = new Uint8Array(input.bytes);
  return new Response(body, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": input.contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `${input.inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    },
  });
}

/** One identical answer for every failure, so the response never reveals why a link or file was refused. */
export function unavailableResponse(status = 404): Response {
  return new Response("This item is unavailable.", { status, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

/** A keyed hash of the client address, so access events can be correlated without storing the address itself. */
export function hashClientIp(ip: string | null): string | null {
  return ip ? createHmac("sha256", getServerEnv().AUTH_SECRET).update(`kit-ip:${ip}`).digest("hex") : null;
}

/** 429 for a client that is asking too often; deliberately says nothing about why or about any link. */
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return new Response("Too many requests. Try again later.", {
    status: 429,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}