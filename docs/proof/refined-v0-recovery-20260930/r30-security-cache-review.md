# R30 security and cache review

Anonymous production HTTP reads ran on 30 September 2026 at 16:50–16:55 UTC. Source review used the unchanged R28 candidate. No local app, browser, test runner, database, build or installation ran. No account credentials, supplied cookies, account writes or deployment actions were used.

## Observed production responses

[Header receipt](r30-public-security-cache-headers.json) contains status, response headers, body hashes and cookie attribute names. It omits cookie values and HTML bodies.

| Request | Result | Cache policy observed |
| --- | --- | --- |
| `/`, `/map`, `/map?sel=venue-1vse4lh` | 200, edge HIT | Public shell, browser revalidation |
| `/places`, `/plan`, `/login?from=%2Fmap`, `/u/you` | 200, edge MISS | Private, no-cache, no-store |
| `/api/account/export` | 401, UNAUTHENTICATED | No-store |
| `/sw.js` | 200, edge HIT | Public, max-age=0, must-revalidate |
| `/data/venues_slim.manifest.json` | 200, edge HIT | Browser max-age=3600, edge s-maxage=31536000 |

All ten sampled responses carried HSTS, nosniff, DENY framing, strict-origin-when-cross-origin referrer policy, permission restrictions and same-origin COOP. The JSON account-export error had no document CSP, matching the API exception. These are bounded observations, not a complete security verdict.

[HTML nonce receipt](r30-public-document-nonce-read.json) adds two consecutive login reads, `/u/you` and `/map?place=edinburgh`. Login nonces differed between requests. Every executable inline script in these four complete HTML responses matched its response CSP nonce. Each response was no-store and had no script-src unsafe-inline. HTTP parsing does not prove browser execution, provider delivery or authenticated isolation.

`/map?sel=` intentionally takes the public shell. `lib/mapDocumentTwin.ts:10–14` assigns selection and camera changes to the client; place, uk, band, crawl and pubs require their own document. The Edinburgh query above took the dynamic document as intended. Public-shell unsafe-inline CSP is an explicit cache tradeoff, not a discovered nonce failure.

The [public version read](r30-public-version-read.json) returned only `{"ok":true}`. It supplied no commit or build identifier. None of these reads proves that local repairs are deployed.

## Plan privacy finding awaiting native reproduction

`app/plan/[id]/page.tsx:47–56` clears stops, crew, context and actions but spreads `state.plan`. That retains `anchorVenueId` and passes it to client `NightCrawlMode` at line 212. `lib/planStore.ts:158` supplies the actual anchor ID. The anonymous preview contract in `lib/planPrivacy.ts:8–10` prohibits venue IDs. The page does not resolve a member capability before serialising these props.

The service worker intentionally caches shared-plan preview documents in `public/sw.js:451–466`. A leaked ID in those props could therefore persist in the offline document. This is a source-traced failure path. No anonymous anchored-plan browser RED or live leak has yet been captured, and no fix has been applied.

The existing `e2e/plan-privacy-boundary.spec.ts` creates an unanchored plan, so its clean anonymous HTML check does not cover this field. `__tests__/planPrivacyPages.test.ts` renders PlanSummary and PlanCrew, not the server page's NightCrawlMode props. Next proof must create an anchored plan through the real local user journey, open its link in an anonymous browser, and inspect the received HTML/RSC before changing redaction. Preserve API, member and offline assertions.

The parent coordinator confirmed at 17:00 UTC that this privacy work remains in Core's existing scope. Native RED is still required before a fix. Integration retains future parser work; Core's retained price-record repair stays separate.

No additional ending venue leak was found. PlanState ending is an enum string; a truthy ending suppresses NightCrawlMode. Venue-bearing completion details belong to a separate DTO.

## Source safeguards checked

- Account export, onboarding, session hints/tokens, messages and Night Profile responses use no-store. Message photos use private, no-store.
- The service worker bypasses API requests and writes. Its document eligibility excludes account, messages, admin and private plan subpages.
- Noncached documents receive per-request nonce CSP. Public assets have separate cache rules. Account HTML inspected carries neutral shells; gated APIs supply private details.

No cross-account shared-cache leak was found in these inspected paths. Real provider login/logout, authenticated cache isolation and durable price write/read remain unproved.

## Dependency finding and ownership

The candidate lock records DOMPurify 3.4.15 through posthog-js's compatible `^3.4.13` range. The [upstream advisory](https://github.com/cure53/DOMPurify/security/advisories/GHSA-p98j-92pf-mc4p) marks versions 3.4.13–3.4.15 affected and 3.4.16 patched. It describes a low-severity DOM XSS path requiring IN_PLACE sanitisation plus a node-removing afterSanitize hook.

Inspected installed PostHog usage sanitises HTML strings with tag/attribute options, without those hooks or IN_PLACE. Product tours are disabled at `lib/posthogClient.ts:306`. The vulnerable dependency is confirmed; an exploitable application path is not established.

SDK hosted OSV check failed on this advisory. The SDK NoMistakes daemon owns its active repair. Core preserves its frozen lock until owner reconciliation; no duplicate installation or manual SDK edit occurred. Earlier absence of high/critical audit findings does not clear this new low-severity hosted failure.

At 17:04 UTC, an independent fetch found published SDK commit `fe0cabf5fe26d5eb45af47863d21051442e9d075`. Its only changed file is package-lock.json, and its DOMPurify edit changes version, tarball URL and integrity to 3.4.16. [Lock comparison receipt](r30-sdk-lock-patch-read.json) confirms Core still has 3.4.15. Hosted PR 1879 checks then reported 16 passed, zero failed and three skipped, including a passed OSV check. The hosted full-browser job was skipped. SDK's fresh local full gate and actual cleanup remained pending; the PR remained draft and unmerged.

The parent coordinator instructed Core to carry this reviewed minimal delta before its next candidate freeze and final gate, after source handoff. Installed-version proof is also required. No lock or installation change has yet occurred in Core.

## Interpretation and next proof

[OWASP header guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html) distinguishes no-store from no-cache: sensitive data must not rely on revalidation alone. The observed private-document and anonymous-export policies include no-store. Header presence does not establish authorisation or safe authenticated state transitions.

Next runtime requires actual previous-owner cleanup, a final grant and fresh preflight. Priorities remain native price/category reproduction, anchored-plan privacy reproduction, repairs, then a fresh original full-five regression and performance checks. Login/logout, deployed security configuration and data freshness still need their own evidence. Goal remains active.
