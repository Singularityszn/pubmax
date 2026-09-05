# CDN-cached documents widened to /tonight, /today and /near

Captain (5 Sep 2026): "Widen." `CDN_CACHED_DOCUMENT_PATHS` in `proxy.ts` now
names `/`, `/map`, `/tonight`, `/today` and `/near`. Each of the three new pages
declares `force-static` and an ISR window; the policy shape is `/map`'s.

## Method

Production build (`npm run build` into `.next-prod`, `NEXT_PUBLIC_SW_VERSION=local`),
served by `next start --port 3193` with `playwright.config.ts`'s own
`webServer.env` (keyless). Headers read with `curl -I`. The CSP line is cut
after `script-src` here; the full header was compared byte for byte against
`/map` and is identical on all four other cached routes.

## Build route table

```
┌ ○ /                                                              1h      1y
├ ○ /map                                                           1h      1y
├ ○ /near                                                          1h      1y
├ ○ /today                                                         5m      1y
├ ○ /tonight                                                       5m      1y
○  (Static)   prerendered as static content
```

## curl -I

```
=== /
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; ...
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-nextjs-prerender: 1
Cache-Control: s-maxage=3600, stale-while-revalidate=31532400
=== /map
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; ...
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-nextjs-prerender: 1
Cache-Control: s-maxage=3600, stale-while-revalidate=31532400
=== /tonight
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; ...
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-nextjs-prerender: 1
Cache-Control: s-maxage=300, stale-while-revalidate=31535700
=== /today
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; ...
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-nextjs-prerender: 1
Cache-Control: s-maxage=300, stale-while-revalidate=31535700
=== /near
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; ...
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-nextjs-prerender: 1
Cache-Control: s-maxage=3600, stale-while-revalidate=31532400
=== /login
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'nonce-ZDc0ZWI5MDgtY2E3ZC00ODExLWIxMTgtNDQxMDc4MTczMmRk' https://va.vercel-scripts.com; ...
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
=== /messages
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'nonce-ZDNlYmI1ZmQtZTRkZC00N2MwLTlhNjktMTIwZjY1NjgzYmYx' https://va.vercel-scripts.com; ...
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
=== /u/you
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'nonce-NTlmMmQ3NTgtMjJjMy00NGMyLWIxNGQtM2RlN2Q1NTI0MmJi' https://va.vercel-scripts.com; ...
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
=== /map/london
HTTP/1.1 200 OK
content-security-policy: default-src 'self'; script-src 'self' 'nonce-YTNmZjRjNzAtN2ZmMC00MTY0LWFkMWMtMDE4YTM1M2M3M2Rj' https://va.vercel-scripts.com; ...
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```

## Browser check (Chromium, 390x844, networkidle)

Each of the three routes hydrates (the client router marks the live tab),
the document names no handle and carries no token, and the only console
errors are the keyless fixture's non-routable Supabase URL refused by
`connect-src`, which `/map` and the nonce'd `/login` report identically.

```
[
  {
    "path": "/tonight",
    "status": 200,
    "cache": "s-maxage=300, stale-while-revalidate=31535700",
    "hydrated": true,
    "consoleErrors": 2,
    "cspViolations": 2,
    "namesHandle": false,
    "sample": [
      "Connecting to 'http://127.0.0.1:54321/auth/v1/settings' violates the following Content Security Policy directive: \"connect-src 'self' https://tiles.openfreemap.",
      "Fetch API cannot load http://127.0.0.1:54321/auth/v1/settings. Refused to connect because it violates the document's Content Security Policy."
    ]
  },
  {
    "path": "/today",
    "status": 200,
    "cache": "s-maxage=300, stale-while-revalidate=31535700",
    "hydrated": true,
    "consoleErrors": 2,
    "cspViolations": 2,
    "namesHandle": false,
    "sample": [
      "Connecting to 'http://127.0.0.1:54321/auth/v1/settings' violates the following Content Security Policy directive: \"connect-src 'self' https://tiles.openfreemap.",
      "Fetch API cannot load http://127.0.0.1:54321/auth/v1/settings. Refused to connect because it violates the document's Content Security Policy."
    ]
  },
  {
    "path": "/near",
    "status": 200,
    "cache": "s-maxage=3600, stale-while-revalidate=31532400",
    "hydrated": true,
    "consoleErrors": 2,
    "cspViolations": 2,
    "namesHandle": false,
    "sample": [
      "Connecting to 'http://127.0.0.1:54321/auth/v1/settings' violates the following Content Security Policy directive: \"connect-src 'self' https://tiles.openfreemap.",
      "Fetch API cannot load http://127.0.0.1:54321/auth/v1/settings. Refused to connect because it violates the document's Content Security Policy."
    ]
  }
]
```

## Fences

- `__tests__/clerkProxyCsp.test.ts`: the five paths take `'unsafe-inline'` and
  no nonce, the three new ones answer `/map`'s policy byte for byte, and
  `/u/you`, `/messages`, `/admin` keep a fresh nonce and are absent from the list.
- `__tests__/cdnCachedDocuments.test.ts`: every listed path is a `force-static`
  page reading nothing per request, every `force-static` page is listed, and
  the London-clock pages take a window of at most 300 s.
- `e2e/borough-crawls-security.spec.ts`: the shipped headers and the
  name-nobody sweep on all five (14 passed against this build).
