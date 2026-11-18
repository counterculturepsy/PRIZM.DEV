import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Document uploads travel through server actions: 4 MB PDF limit plus form overhead, still under Vercel's 4.5 MB request cap.
  experimental: { serverActions: { bodySizeLimit: "4.4mb" } },
  // The PDF routes read the bundled fonts from disk at runtime, so the file tracer must be told to ship them.
  outputFileTracingIncludes: {
    "/s/[token]": ["./assets/fonts/**"],
    "/api/kits/packs/[packId]/pdf": ["./assets/fonts/**"],
  },
  reactStrictMode: true,
  // Keep verification builds separate from the live development server's cache.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    qualities: [75, 92],
  },
  // Dev only: without this, a browser on 127.0.0.1 has its hot-reload socket blocked and the page reloads in a loop.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
