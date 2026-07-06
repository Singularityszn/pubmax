import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Baseline security headers on every response. Deliberately conservative: a full
// Content-Security-Policy is DEFERRED — it must be validated against MapLibre's
// blob-URL workers + tile hosts, Supabase Storage/Auth, and the inline no-flash
// theme script in app/layout.tsx (a wrong CSP silently breaks the map). See the
// Opus handoff for the CSP recipe (hash the theme script, allow worker-src blob:).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // The app legitimately uses the camera (Pint Drop composer) and geolocation
  // ("pubs near me" / nearest-venue) on its own origin; everything else denied.
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The pub-price dataset is ~6 MB and effectively static between deploys.
        // Cache it hard at CDN + browser so it isn't re-downloaded every visit;
        // stale-while-revalidate keeps updates propagating without a hard block.
        source: "/data/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
