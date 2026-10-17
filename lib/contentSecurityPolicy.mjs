// THE ONE CONTENT-SECURITY-POLICY BUILDER, FOR THE PROXY AND FOR THE CONFIG.
//
// proxy.ts builds a policy per request with a fresh nonce. The five public
// documents in lib/cdnDocumentEdge.mjs never run the proxy on the canonical
// host (task vercel-f1-cdn-documents): their policy carries `'unsafe-inline'`
// in the nonce slot and is otherwise a pure function of the build's env, so
// next.config.mjs ships it as a static `headers()` rule with no function in
// the path. Both callers build it HERE, so the two copies cannot drift:
// `__tests__/cdnDocumentEdge.test.ts` holds the config header to the policy
// securityProxy answers for the same path under the same env.
//
// This is plain ESM with a `.d.mts` sidecar (the `lib/staticAssetPrefixes.mjs`
// pattern) because next.config.mjs cannot import TypeScript.
// lib/clerkIdentity.ts and lib/supabaseCsp.ts re-export the parsers below, so
// every TypeScript caller keeps its import.

/**
 * Cloudflare Turnstile, which Clerk uses for bot protection on sign-up.
 * Needed by `script-src` (the challenge widget) and `frame-src` (its iframe).
 */
export const CLERK_BOT_PROTECTION_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Clerk's abuse and fraud protection hosts. This is the ONE Clerk entry with a
 * wildcard, and the wildcard is a subdomain wildcard inside a Clerk-owned
 * registrable domain (never a wildcard directive, never a bare scheme): Clerk
 * shards these per deployment, so the exact subdomain is not knowable here.
 */
export const CLERK_ABUSE_PROTECTION_ORIGIN = "https://*.protect.clerk.com";

/** Clerk's own image CDN, which serves account avatars in <UserButton>. */
export const CLERK_IMAGE_ORIGIN = "https://img.clerk.com";

/**
 * The instance Frontend API origin, decoded from a publishable key.
 *
 * Returns null for anything that is not a well-formed key, which is what makes
 * a malformed value fail CLOSED: no origin means Clerk stays off and the CSP
 * gains nothing, rather than an attacker-supplied host being admitted into
 * `script-src` by a key that merely looked close enough.
 */
export function clerkFrontendApiOriginFromKey(publishableKey) {
  const key = publishableKey?.trim();
  if (!key) return null;

  const payload =
    key.startsWith("pk_test_") ? key.slice("pk_test_".length)
    : key.startsWith("pk_live_") ? key.slice("pk_live_".length)
    : null;
  if (!payload) return null;

  // Decode on both runtimes. Node has Buffer; browsers have atob. Keeping this
  // public-key parser runtime-neutral lets security-policy callers validate a
  // key without depending on a Node-only global. The payload is ASCII (host +
  // `$`), so atob is exact.
  let decoded;
  try {
    decoded =
      typeof Buffer !== "undefined"
        ? Buffer.from(payload, "base64").toString("utf8")
        : atob(payload);
  } catch {
    return null;
  }

  // The payload is the host plus a single `$` terminator. A payload without it
  // was not a Clerk key, whatever it decoded to.
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1).toLowerCase();

  // A host, and only a host: no scheme, no port, no path, no credentials, no
  // wildcard. This is the fence that stops a crafted key widening the policy.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    return null;
  }

  return `https://${host}`;
}

const NO_CLERK_SOURCES = Object.freeze({
  script: Object.freeze([]),
  connect: Object.freeze([]),
  img: Object.freeze([]),
  frame: Object.freeze([]),
});

/**
 * Clerk's CSP additions, per Clerk's own CSP guidance
 * (https://clerk.com/docs/guides/secure/best-practices/csp-headers).
 *
 * Empty in every directive when the key is absent or malformed, so the shipped
 * policy is byte-for-byte the pre-Clerk policy until the captain sets a key.
 *
 * Deliberately NOT included: `style-src 'unsafe-inline'` and `worker-src blob:`,
 * which Clerk also requires and which the policy already carries for MapLibre.
 * They are listed here in a comment rather than the return value so nothing
 * re-adds them and so a future MapLibre change cannot quietly remove them
 * without a Clerk test noticing (__tests__/clerkProxyCsp.test.ts asserts both).
 */
export function clerkCspSourcesFromKey(publishableKey) {
  const frontendApi = clerkFrontendApiOriginFromKey(publishableKey);
  if (!frontendApi) return NO_CLERK_SOURCES;

  return {
    // clerk-js itself is served from the instance Frontend API host.
    script: [frontendApi, CLERK_BOT_PROTECTION_ORIGIN, CLERK_ABUSE_PROTECTION_ORIGIN],
    // Session, sign-in and sign-up calls go to the same host.
    connect: [frontendApi, CLERK_ABUSE_PROTECTION_ORIGIN],
    // Account avatars only. Clerk uploads are NOT routed via /api/image-proxy
    // because they are first-party account images, not third-party venue photos.
    img: [CLERK_IMAGE_ORIGIN],
    // The Turnstile challenge and the abuse-protection frames.
    frame: [CLERK_BOT_PROTECTION_ORIGIN, CLERK_ABUSE_PROTECTION_ORIGIN],
  };
}

function supabaseOriginFromUrl(url) {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const { protocol, host } = new URL(trimmed);
    if (protocol !== "https:" && protocol !== "http:") return null;
    if (!host.endsWith(".supabase.co")) return null;
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

/**
 * Exact Supabase origins for CSP connect-src / img-src. Wildcard `*.supabase.co`
 * would allow exfiltration to any tenant project; pin the configured project
 * host instead (same idea as the Clerk origin above). Null when no Supabase
 * project URL is set.
 */
export function supabaseCspOriginsFromEnv(env) {
  const https =
    supabaseOriginFromUrl(env.NEXT_PUBLIC_SUPABASE_URL) ??
    supabaseOriginFromUrl(env.SUPABASE_URL);
  if (!https) return null;
  const wss = https.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return { https, wss };
}

/**
 * Local development may point NEXT_PUBLIC_SUPABASE_URL at an auth stack on
 * this machine (`supabase start`, or a stub GoTrue for keyless auth testing);
 * the `*.supabase.co` allowance never covers that origin, so browser sign-in
 * silently dies under the CSP. The extra origin joins connect-src only under
 * `next dev`: production builds never widen.
 */
export function devSupabaseConnectOrigin(env, isDev) {
  if (!isDev) return null;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    const origin = new URL(url).origin;
    return origin.endsWith(".supabase.co") ? null : origin;
  } catch {
    return null;
  }
}

/**
 * The script slot a prerendered document takes instead of a nonce. A CDN copy
 * is handed to every visitor, so it cannot carry a per-request secret. What it
 * costs is exactly this: Next's own inline RSC bootstrap and our two inline
 * blocks in app/layout.tsx (speculation rules, site JSON-LD) are admitted by
 * being inline rather than by carrying a secret. Those documents render no
 * personal data and take no user input into markup.
 */
export const CDN_DOCUMENT_INLINE_SCRIPT_SOURCE = "'unsafe-inline'";

/**
 * The policy, as one string.
 *
 * `inlineScriptSource` is `'nonce-<value>'` on every per-request document and
 * CDN_DOCUMENT_INLINE_SCRIPT_SOURCE on a prerendered one; it is the ONLY input
 * that differs between them.
 */
export function buildContentSecurityPolicy({
  inlineScriptSource,
  isDev,
  clerk,
  supabase,
  devSupabaseConnect,
}) {
  const supabaseImg = supabase ? ` ${supabase.https}` : "";
  const supabaseConnect = supabase ? ` ${supabase.https} ${supabase.wss}` : "";
  const devConnect = devSupabaseConnect ? ` ${devSupabaseConnect}` : "";
  const clerkScript = clerk.script.map((origin) => ` ${origin}`).join("");

  // script-src: NO 'unsafe-inline' on a nonced document (browsers ignore
  //   'unsafe-inline' whenever a nonce is present anyway). 'self' covers the
  //   external theme-init + the async /_next/static chunk bundles;
  //   'nonce-<value>' covers Next's inline RSC bootstrap + hydration payload
  //   and our own nonce-stamped inline scripts. Local `next dev` additionally
  //   gets 'unsafe-eval' because React's development tooling uses eval for
  //   call-stack reconstruction; production never does.
  //   NB: no 'strict-dynamic' — it would make the browser ignore the 'self'
  //   source expression, blocking the parser-inserted external theme-init.js;
  //   Next's chunk loading is happy under plain 'self' + a nonce'd bootstrap.
  //   The external host is va.vercel-scripts.com for Vercel Analytics.
  //   Vercel injects its tag itself, so it carries no nonce of ours; the script
  //   is still consent-gated in the app (`beforeSend` cancels pre-consent
  //   pageviews — docs/OBSERVABILITY_CERTIFICATION.md), so allowing that origin
  //   does not widen what may be collected, only what may load.
  //   Speed Insights loads same-origin `/_vercel/speed-insights/*` (script +
  //   vitals beacon) under `'self'` in script-src and connect-src; it is also
  //   consent-gated in the app (`beforeSend` cancels pre-consent vitals).
  //   Clerk adds its instance Frontend API host (which serves clerk-js), the
  //   Cloudflare Turnstile challenge host and Clerk's abuse-protection hosts.
  //   Every one of them is an exact origin derived from the publishable key or
  //   named above; NONE of them is 'unsafe-inline', and nothing here relaxes
  //   the nonce contract. With no Clerk key set, `clerk.script` is empty.
  //   Voice AudioWorklets are same-origin files under /vendor/elevenlabs,
  //   copied by `npm run dev` and `npm run build` and passed as workletPaths
  //   when a session starts. data: and blob: are not script sources: a data:
  //   URL would run without a nonce.
  const scriptSrc = `script-src 'self' ${inlineScriptSource} https://va.vercel-scripts.com${clerkScript}${isDev ? " 'unsafe-eval'" : ""}`;

  // frame-src did not exist before Clerk: framing fell through to `child-src
  // blob:`, so blob: frames were the only ones allowed. Turnstile and Clerk's
  // abuse protection both render in iframes, so the directive becomes explicit
  // — and it KEEPS blob: so the fallback's existing permission is preserved
  // rather than quietly revoked. It stays absent entirely when Clerk is off.
  const clerkFrameSrc =
    clerk.frame.length > 0 ? [`frame-src blob: ${clerk.frame.join(" ")}`] : [];

  // The baseline non-script directives below follow the previous static CSP in
  // next.config.mjs. See that file's history for the per-directive rationale.
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // img-src is deliberately MINIMAL — a "proxy-or-nothing" guard (image
    // rights audit U9, docs/IMAGE_RIGHTS_AUDIT_2026-07-21.md). Only origins the
    // BROWSER loads directly are listed: Wikimedia (landmark stories on the map
    // + /landmark/[id], via Special:FilePath, whose redirect chain ends on
    // thumb.wikimedia.org for a sized file and upload.wikimedia.org for the
    // original; MEASURED 2026-09-05, a width-sized request 302s to
    // Special:Redirect/file, then 301s to thumb.wikimedia.org, and a host
    // missing here drew every landmark hero as a broken-image glyph with the
    // credit bar still under it), the Greene King Sitecore DAM (the 4 food-menu tiles
    // MenuCategoryGrid renders raw), *.supabase.co (community Pint Drop photos +
    // user avatars, our own bucket) and *.googleusercontent.com (Google IdP
    // sign-in/profile avatars). Every OTHER venue photo — the ~439 open-ended
    // pub-website hosts plus the brand/platform CDNs — is fetched server-side by
    // /api/image-proxy and re-served same-origin, so it loads under 'self' and
    // needs no entry here. The brand/platform origins that USED to be listed
    // (jdwetherspoon, greeneking, staticflickr, tripadvisor, squarespace-cdn,
    // inapub, wixstatic, whatpub S3, gstatic) were dead — never loaded directly —
    // and were removed so a future direct hotlink of unlicensed imagery fails
    // visibly instead of silently shipping. Do NOT re-add a third-party image
    // host here: route it through /api/image-proxy (and license it) instead.
    // Clerk adds https://img.clerk.com here, its own account-avatar CDN. It is
    // a first-party ACCOUNT image, not a third-party venue photo, so the
    // "proxy-or-nothing" rule above is untouched: no venue imagery may join it.
    `img-src 'self' data: blob: https://commons.wikimedia.org https://upload.wikimedia.org https://thumb.wikimedia.org${supabaseImg} https://*.googleusercontent.com https://gkbr-p-001.sitecorecontenthub.cloud${clerk.img.map((origin) => ` ${origin}`).join("")}`,
    "font-src 'self' data: https://tiles.openfreemap.org",
    // Clerk adds its Frontend API host (session, sign-in and sign-up calls) and
    // its abuse-protection hosts. Supabase's entries stay: both auth systems
    // run side by side, and removing either would break the other's sign-in.
    `connect-src 'self' https://tiles.openfreemap.org https://basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com${supabaseConnect} wss://api.elevenlabs.io https://api.elevenlabs.io${devConnect}${clerk.connect.map((origin) => ` ${origin}`).join("")}`,
    // Clerk also requires worker-src 'self' blob: — already true for MapLibre's
    // tile workers and the offline service worker, so it needs no change here.
    "worker-src 'self' blob:",
    "child-src blob:",
    ...clerkFrameSrc,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Every env-derived input to the policy, read from one env object. proxy.ts
 * passes `process.env` at request time; next.config.mjs passes it at build
 * time. On Vercel those are the same values: an env change needs a redeploy.
 */
export function contentSecurityPolicySources(env) {
  const isDev = env.NODE_ENV === "development";
  return {
    isDev,
    clerk: clerkCspSourcesFromKey(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    supabase: supabaseCspOriginsFromEnv(env),
    devSupabaseConnect: devSupabaseConnectOrigin(env, isDev),
  };
}

/** The whole policy a prerendered public document ships with. */
export function cdnDocumentContentSecurityPolicy(env) {
  return buildContentSecurityPolicy({
    ...contentSecurityPolicySources(env),
    inlineScriptSource: CDN_DOCUMENT_INLINE_SCRIPT_SOURCE,
  });
}
