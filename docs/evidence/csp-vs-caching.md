# CSP versus HTML caching

Reviewed 30 July 2026. This is a decision brief, not an implementation. No CSP, nonce, rendering, or caching behaviour changed in this branch.

## Current boundary

`proxy.ts` creates a cryptographically random nonce for every HTML request. It places that nonce in the request CSP so Next.js can stamp its inline React Server Component bootstrap and hydration scripts, and in the response CSP so the browser can enforce the same value. App-owned inline JSON-LD and speculation rules receive the nonce through `x-nonce`.

The current `script-src` allows:

- inline scripts carrying the current response's nonce;
- external same-origin scripts, including Next chunks and `theme-init.js`;
- Vercel Analytics from its named host;
- `unsafe-eval` in development only.

It does not allow `unsafe-inline` for scripts. An attacker who can inject an arbitrary inline `<script>` does not know the current nonce, so the browser blocks it. The nonce is not a general XSS cure: a compromised allowed script, a same-origin script endpoint that serves attacker-controlled JavaScript, or a nonce-hijacking flaw can still defeat the boundary. `style-src 'unsafe-inline'` remains a separately documented MapLibre tradeoff in `docs/SECURITY_POSTURE.md`.

Next.js extracts a nonce from the request CSP while rendering. Static pages have no request from which to get a fresh value, so nonce CSP requires dynamic rendering and prevents static optimisation, ISR, PPR, and reusable CDN-cached HTML. This is the framework's documented constraint, not an app-specific assumption. See the [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy).

Reusing one nonce across cached responses is not an option. It would turn a one-response authorisation token into a reusable value and defeat the reason for minting it per request.

## Measured latency context

Three sequential production samples were run with:

```bash
for route_path in / /map; do
  for sample_number in 1 2 3; do
    curl -sS -o /dev/null -w "route=${route_path} sample=${sample_number} status=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s bytes=%{size_download}\n" "https://pubmaxxing.com${route_path}"
  done
done
```

| Route | Sample 1 TTFB / total | Sample 2 | Sample 3 | Bytes |
| --- | ---: | ---: | ---: | ---: |
| `/` | 2.813088s / 2.890380s | 0.507839s / 0.612744s | 0.368392s / 0.505124s | 74,342 |
| `/map` | 2.327069s / 2.404465s | 0.195478s / 0.273945s | 0.404862s / 0.417503s | 49,925 |

These sequential samples reproduce the cold-looking first request and much faster following requests. They do not prove three independent production cold starts.

A same-host cached static asset was measured as a rough network and edge reference:

```bash
for sample_number in 1 2 3; do
  curl -sS -o /dev/null -w "route=/favicon.ico sample=${sample_number} ttfb=%{time_starttransfer}s total=%{time_total}s bytes=%{size_download}\n" https://pubmaxxing.com/favicon.ico
done
```

`/favicon.ico` returned `x-vercel-cache: HIT`, `age: 1036`, and TTFB of 0.054439s, 0.053206s, and 0.052709s. This is not an HTML measurement. It only shows the order of latency already observed for a tiny cached response from the same domain and client.

## Options

### 1. Keep fresh nonces and dynamic HTML

Security consequence:

- Preserves current per-response inline-script authorisation.
- Keeps arbitrary injected inline scripts blocked without trusting a reusable token.
- Retains current named external-script allowlist.

Expected speed:

- No HTML caching gain.
- London function placement and future bundle reduction can still reduce dynamic cold and warm time. Neither production effect is measured in this branch.

Plan fit:

- No new service, dependency, or paid feature.
- Continues to spend function CPU and memory on every HTML request.

### 2. Hash-based CSP with static rendering

Build-time hashes authorise exact script bytes instead of a fresh per-request token. If every required inline and external script has a matching hash or integrity value, arbitrary injected script still fails. The HTML and CSP can then be stable across requests and eligible for static generation and CDN caching.

Security consequence:

- Keeps a strict script policy when hash coverage is complete and `unsafe-inline` remains absent.
- Makes build output integrity part of the security boundary. Any untracked inline script breaks the page or pressures maintainers to weaken CSP.
- A compromised script whose exact bytes were intentionally hashed remains trusted until the next build replaces it.
- Requires tests for Next bootstrap, streamed RSC payloads, JSON-LD, speculation rules, theme bootstrap, analytics, and every route-specific inline handler.

Expected speed:

- Removes function boot and server render from a CDN cache hit.
- The measured cached static asset returned in 52.709ms to 54.439ms, while first HTML samples took 2.327s to 2.813s before first byte. Cached HTML has not been built or measured, so this is a target envelope, not a claimed result.

Framework constraint:

- Next.js offers experimental Subresource Integrity for hash-based CSP in App Router applications. It is a build-time feature and cannot cover dynamically generated scripts. This repository uses the App Router, and installed Next.js 16.2.11 includes Turbopack SRI manifest support. Adopting SRI still requires a full build, policy, and hydration check, not a CSP-header edit.

Plan fit:

- Vercel CDN caching is available on all plans, so this does not inherently require a service beyond the current 20 dollar plan. See [Vercel CDN cache](https://vercel.com/docs/caching/cdn-cache).
- Static hits should reduce function usage. Enabling an experimental build feature may change build duration and output size, which must be measured before adoption.

### 3. Add `strict-dynamic`

`strict-dynamic` is a trust propagation rule, not a caching strategy. In CSP3 browsers, a nonce-authorised or hash-authorised script may load non-parser-inserted descendant scripts. The browser ignores host and scheme sources such as `'self'` for script loading. The [CSP Level 3 specification](https://www.w3.org/TR/CSP/#strict-dynamic-usage) recommends auditing every runtime-created script URL because attacker-controlled loader input can become arbitrary script loading.

Security consequence:

- Simplifies frameworks whose trusted bootstrap must load script descendants.
- Broadens trust from one approved script to scripts it creates. A script gadget that accepts attacker-controlled URLs becomes more dangerous.
- Current parser-inserted `theme-init.js` and Vercel Analytics loading would need explicit compatibility proof because current `'self'` and host allowances are ignored in modern browsers once `strict-dynamic` applies.

Expected speed:

- With the current fresh nonce, expected TTFB gain is zero because HTML remains dynamic and uncacheable.
- With stable hashes and static HTML, cache potential is the same as option 2. `strict-dynamic` adds no independent speed gain.

Plan fit:

- No paid platform feature.
- Requires a script-loader audit and browser coverage work. Do not add it only to make another CSP configuration easier.

### 4. Cache only anonymous requests

An anonymous lane could serve stable hash-authorised HTML from CDN while authenticated or personalised requests keep dynamic nonce CSP.

Security consequence:

- A cached anonymous response must contain no account data, `Set-Cookie`, private state, or request-specific nonce.
- Cache keys and routing must separate anonymous and authenticated requests without ambiguity. One missed cookie or header boundary can leak one person's HTML to another.
- A fresh nonce cannot survive in the cached anonymous response. That lane still needs hash-based CSP or another static-safe authorisation model.
- Vercel documents that responses with `Authorization`, `Set-Cookie`, `private`, `no-cache`, or `no-store` are not cacheable. See [Vercel cacheable response criteria](https://vercel.com/docs/caching/cdn-cache#cacheable-response-criteria).

Expected speed:

- Anonymous cache hits could avoid function boot and approach the same edge envelope as option 2.
- Authenticated traffic remains dynamic. No anonymous HTML variant exists in this branch, so no hit rate or latency gain has been measured.

Plan fit:

- CDN caching itself fits the current plan.
- Request classification may add proxy or function usage and a second rendering path. That complexity is harder to secure than a route-level static/dynamic split.

## Recommendation

Launch with option 1. Keep the current nonce boundary, deploy the already committed London region setting through normal git flow, and reduce the accidental function trace in a separate measured change. This is the smallest launch-safe path and claims no unmeasured production improvement.

After launch, prototype option 2 for public `/` and `/map` routes in an isolated branch. Keep Next's SRI status and build-time limitation explicit. Accept the prototype only if:

- every inline and external script works under enforced CSP with no `unsafe-inline` in `script-src`;
- hydration, RSC navigation, JSON-LD, speculation rules, theme bootstrap, analytics, and offline boot pass;
- production-like headers show cacheable HTML and repeated requests show `x-vercel-cache: HIT`;
- HTML contains no account or request-specific state;
- cold, warm, and cache-hit samples improve without route regression.

Use `strict-dynamic` only if a tested framework loader needs it and every dynamic script URL is audited. Prefer a route-level static CSP split over anonymous cookie classification. It has fewer identity boundaries and fewer ways to cache private output.

needs-decision: Captain must choose whether to keep nonce-based dynamic HTML permanently or authorise a separate Next.js SRI prototype for static public routes after launch.
