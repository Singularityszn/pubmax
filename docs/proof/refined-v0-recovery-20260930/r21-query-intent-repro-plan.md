# R21 query-preserving intent reproduction plan

Source-only preparation. Only this receipt written. No browser, tests, build, install, repository/index edit, SQL, account write or publication. Read-only `gh-axi issue view 1641 --full` confirmed current acceptance; parent archived it in `docs/proof/refined-v0-recovery-20260930/r21-issue-acceptance-reconciliation.md`. Historical memory finding was refreshed against current source and issue, not used as current runtime proof.

## Current owned behavior

- `lib/mapWarmup.ts:182-218`: `warmNavRoute` drops fragment **and query**, calls `router.prefetch` with bare path, then adds that path to its set only after synchronous successful call. A throwing call leaves key eligible for another intent. This does not certify asynchronous network success.
- Three sets use this owner: default `warmedRoutes` (`mapWarmup.ts:152`), `IntentLink` module `warmed` (`components/nav/IntentLink.tsx:22-31`), and `MobileTabBar` module `warmedTabs` (`components/nav/MobileTabBar.tsx:55,145`). Default-only pruning would miss both live passed sets.
- `IntentLink` disables viewport prefetch and warms on pointer enter/down, focus and touch. String hrefs warm; UrlObject hrefs currently do not. Preserve callbacks and original navigation href.
- Social public switcher is `.socialSwitcher` / `aria-label="Social view"`, with `Posts` `/social` and `Pubs & pints` `/social?tab=discover` (`app/social/SocialPageClient.tsx:778-788`). Query changes server output: `app/social/page.tsx:54-62` only loads rivalry/heritage for discover with launch enabled.
- Nearby `/social?feed=nearby` and Across town `/social?feed=discover` are real `PostsControls` links (`SocialPageClient.tsx:295-312`), but mount only with launch enabled, posts tab, resolved viewer and verified access (`:687-697`). Signed-out public browser cannot exercise Nearby. `router.push` for area select keeps `feed=nearby&area=...`; this is direct navigation, not an intent-prefetch caller.
- `PUBMAX_SOCIAL_FRIENDS_LAUNCH` defaults on unless explicitly `0` (`lib/socialLaunch.ts:8-13`). Rollback is preview, not equivalent public discovery behavior. Record actual visible launch state/server build setting before attributing cost.

Installed Next16.3 guide `node_modules/next/dist/docs/01-app/02-guides/prefetching.md` says automatic prefetch is production-only, manual `router.prefetch(href)` warms provided destination, and dynamic/PPR shells may still require a server roundtrip on click. Installed `app-router-instance.js:300-318` defaults manual prefetch strategy to PPR; `segment-cache/cache-key.js:26-30` retains original URL search. Do not promise zero click requests or force FULL strategy to make a test pass. `next.config.mjs:244` already has dynamic180/static300s cache lifetimes; do not change them.

## Smallest production RED procedure, after runtime authorization

1. Use existing owned production build/server and installed Playwright, fresh context at390x844, denied consent/arrival dismissed, service workers blocked. Install request/response observation **before** navigation. No provider stubs needed for public case. Record same-origin URL, method, initiation/response time and public RSC/prefetch headers; count RSC separately from JS/CSS, map-data and API requests. Preserve real responses.
2. Open `/social?feed=discover` in fresh document. This is a valid public posts-shell arrival with a different query from intended discover tab. Verify visible `Pubs & pints` link and exact href `/social?tab=discover`; record initial/background requests separately. Avoid discovery navigation or hover beforehand, which could warm intended query.
3. Native hover `Pubs & pints`, move pointer away, native focus same link, then native click. Capture each phase independently. RED oracle is a real pre-click RSC acquisition for intended full query, not any `/social` request. Current source predicts no intended-query warm; repeated focus/pointerdown gets deduped under bare `/social`. Bare-path acquisition may itself be absent because Next can already reuse current shell, so do not require it to prove failure.
4. Assert native click lands `/social?tab=discover`, switcher aria-current updates and real discovery content answers. Report any fresh click RSC acquisition; it demonstrates consequence but is not an automatic failure under installed PPR behavior. Never intercept router API/private cache or dispatch fake DOM events to claim native proof.
5. If installed Next legitimately produces no distinguishable pre-click destination RSC on either version, this network oracle is insufficient. Keep that result honest, preserve behavioral helper tests, and refine observation before claiming browser GREEN. Do not alter prefetch kind, query, profile or budget merely to manufacture it.

## Required sibling case and authority boundary

Acceptance specifically requires discover then Nearby not deduped away. On verified posts surface `/social`, hover/focus `Pubs & pints` without clicking, then hover/focus `Nearby` under `Post lanes`. Both links coexist. Keep first destination unvisited; record separate actual pre-click acquisitions for `tab=discover` and `feed=nearby`, then native click Nearby and assert exact URL plus `Nearby area` field. Empty-area Nearby intentionally waits for area and need not issue feed API yet (`e2e/social-shell.spec.ts:255-262`). Native click Across town afterward is optional additional distinct-query evidence, not required broad crawl.

Real provider-backed session requires authorized existing verified account, without any account mutation. Existing `e2e/social-shell.spec.ts` has provider-shaped `seedSocialSession`, canonical identity/access doubles and real routing; extend closest existing case if needed. Such evidence proves app interaction with modeled identity only, not provider sign-in or real protected API/backend behavior. Do not describe unavailable signed-in lane as covered by anonymous public case.

## Bounded future delta, no implementation here

Keep full string href minus literal fragment as prefetch/dedupe key, including query order/encoding; encoded `%23` stays intact. Empty/hash-only target should not warm another address. Keep original Link href, including fragment, for click.

Separately derive pathname only for map classification. Existing `isMapRoute = prefetchHref === '/map' || ...startsWith('/map/')` would reject `/map?log=1` after a query-only edit. Existing `warmPathsForMapHref` already strips query for city payload selection. Preserve canvas warming, data/saveData policy and their own `sessionSeen` ownership.

Proposed simple bound: retain at most64 successful route keys **per existing set**, insertion-order FIFO. This is a dedupe-memory cap, not a router cache, fetch quota or performance budget. Enforce in common helper for default and passed sets; do not introduce new store/interface. Trim oldest keys after successful addition; an evicted key may warm again on future intent. Existing callers start empty. Explicitly decide/document handling of caller-supplied already-oversized set (trim at entry if promising cap after every call). Normal within-cap synchronous throw must still leave set unchanged and allow retry. Repeated in-cap key must remain deduped; no hidden time expiry or async cache framework.

Focused meaningful tests in existing `__tests__/mapWarmup.test.ts`:
- discover full href then Nearby full href each passed exactly once; repeat pointer/focus semantic calls do not add requests;
- full query plus fragment preserves query, drops fragment; bare path and sibling queries remain distinct; pure fragment no prefetch;
- exceed64 through default owner and same caller-provided Set; recent key dedupes, oldest evicted key retries, supplied Set identity unchanged; no private Set export/AST mirror needed;
- throwing prefetch remains retryable, including near capacity;
- `/map?log=1` and `/map` now distinct route keys but map data remains correctly scoped/deduped; `/map/bath?...` warms Bath. Update current tests that explicitly assert incorrect query stripping (`:224-237`, `:248-255`) rather than loosening assertions.

## Before/after surface counts, actual network only

Same production profile, returning visitor state and scripted native intent order on before/after builds. Fresh context per surface/state; do not carry dedupe/cache between measurements. Report idle phase, hover/focus phase and click phase separately with initiated/completed/cancelled RSC counts and unique full destinations. Count actual network events, not grep links or mocked router calls. Compare corresponding event sequences without demanding a guessed fixed total, because Next can coalesce/cache requests.

- Mobile dock on `/` at390x844: scope `nav[aria-label="Primary"]`, six actual Tonight/Map/Places/Out/Plan/You hrefs. Hover then focus each, repeat cycle, capture actual route-prefetch and map-data counts; one native click validates navigation. Social is not a dock tab. All current dock hrefs are query-free, including preferred-city map and known handle; expected semantic change is none, but network counts must be measured.
- Landing default city unset: warmProps is `{}` (`components/landing/LandingPage.tsx:79-86`), so landing map text links do not manually warm on intent. Primary Near action is separate query-bearing Link and not this helper. Measure actual existing links rather than inventing a landing query caller.
- Landing actual preferred city set with canonical storage key `pubmax:preferredCity:v1`: warmProps activates on `Open the map` and footer `The map` (`LandingPage.tsx:148-153,178`). Both share exact city map href and default helper set. Capture hover/focus repeated across both then click; report route versus city-data counts. Exclude dock intents during this run and count any background requests separately.

No numerical before/after network result exists in this receipt. No source repair, runtime RED/GREEN, provider proof or issue-close claim made.
