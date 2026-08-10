# PUBMAXX repair review PRD

Status: ready for Fable review

Date: 2026-08-11

Review branch: `codex/weekend-audit-repair-20260810`

Implementation commit: `102a2f431` (`fix: complete weekend audit repair sweep`)

Baseline: `origin/main` at `b9e68388a`

Current `origin/main` after the review push: `d0c6f5937` (`docs: close growth release handoff (#1008)`). Main now includes the separately merged growth commits `#1007` and `#1008`. This branch keeps the audit-start baseline and was not rebased during this documentation task. Fable should review the repair delta from `b9e68388a` and then check its interaction with current main before merge.

This document records the weekend audit repair sweep, related feature work found in other threads, and all verification completed for this branch. It is a review handoff, not release approval. The user has authorised this branch push. No production deployment, production migration, production data mutation, or pull request creation is part of this task.

## Fable decision requested

Review the implementation commit and this evidence. Confirm that the branch is safe to continue to normal GitHub review. Keep production release blocked until the items in the blocked and deferred sections have owners and fresh evidence.

## Product and safety position

PUBMAXX must protect user data before it optimises growth or convenience.

- Server-owned identity decides access, ownership, and relationship checks.
- Private Social media is authorised again on every request.
- Cookies, refresh tokens, local account records, signed URLs, and private media do not enter logs, analytics, screenshots, or fixtures.
- Public profile fields are disclosed as public. Private identity fields stay private.
- A missing external provider or stale feed stays visible as missing or stale. The product does not invent prices, freshness timestamps, or user data.
- Alcohol-free choices, soft plans, safe travel, and private memories remain valid product paths. The product does not reward speed, volume, units, or drinking streaks.

## Scope

This branch addresses the 24 findings from the weekend audit and related bugs in the Social, Wanted, Map, Plan, legal, data freshness, dependency, accessibility, and edge-runtime paths.

### Finding status matrix

| # | Finding | Status | Evidence or next action |
|---|---|---|---|
| 1 | OpenAI image processing was narrower than code | Fixed | Legal copy and `legalPages` tests cover Social, profile, message, and venue-wall image paths. |
| 2 | DOB wording did not match the adult gate | Fixed | Legal copy and Social launch tests cover stored DOB precedence and one recorded adult self-assertion. |
| 3 | Device session disclosure described one browser session | Fixed | Copy names up to five account records, refresh tokens, email, handle, activity timestamps, purpose, retention, and removal. |
| 4 | Public profile fields were absent from legal pages | Fixed | Favourite drink, interests, and workplace are named as public profile fields. |
| 5 | Cross-site GET could redeem `pubmax_resume` | Fixed | GET no longer redeems the resume cookie. Attacker-origin and bearer-path regression tests pass. |
| 6 | Message open was not durable or recipient-safe | Fixed | Limiting runs before durable open dispatch. Handles are normalised and must resolve to an active claimed recipient. Concurrency tests pass. |
| 7 | Copied Social media URLs outlived relationship changes | Fixed | Media is delivered through an authorised private route with `no-store`; block and unfriend changes take effect on the next request. |
| 8 | `posthog-js` exposed an affected DOMPurify range | Fixed | `posthog-js` was upgraded, `dompurify` is constrained to `3.4.13`, `uuid` to `11.1.1`, and lockfile audits are clean. |
| 9 | CSP used broad `unsafe-inline` | Fixed with narrow exceptions | Nonce routes no longer use the broad exception. Root and map exceptions remain scoped and covered by CSP tests. |
| 10 | Complete security sweep was required | Verified with caveats | Dependency, OSV, SAST, secret, SBOM, auth, RLS, media, cache, SSRF, and local load checks ran. Residual scanner and environment notes are below. |
| 11 | Wanted resolver returned no Reel, TikTok, or YouTube candidates | Fixed | Licensed public metadata and oEmbed resolution has HTTPS, host allowlists, timeout, body bounds, safe parsing, and SSRF tests. |
| 12 | Wanted lacked drink interest, visibility, Crew, and Soft Plan actions | Fixed | Optional drink interest, `private`, `mutuals`, and `crew:<id>` visibility plus owner and relationship checks are covered by store, route, migration, and UI tests. |
| 13 | Map price control lacked mobile behaviour | Fixed | Mobile path opens from the compact control and auto-collapses after selection or dismissal. |
| 14 | Map-search telemetry used unbounded `void` work | Fixed | Serverless completion uses `after()` with failure isolation and completion tests. |
| 15 | Manifest used `PUBMAXXING` as product name | Fixed | Installed product metadata uses canonical `PUBMAXX`. |
| 16 | Social context rail cards were too narrow | Fixed | Container-aware rail rules keep the narrow desktop rail readable at 1440 pixels. |
| 17 | Lighthouse found ARIA id and name mismatches | Fixed | City chooser, landing, and Thames hero wiring now uses matching controls and accessible names. |
| 18 | Mobile Map, Social, and Plan paths clipped or dead-ended | Fixed | 320 pixel map chips, signed-out Social hierarchy, and the first Plan screen were reviewed and regression-tested. |
| 19 | Social and skip-link styles used one-off tokens | Fixed | Raw z-index and colour values were replaced with project semantic tokens and token tests. |
| 20 | Refresh-token and media lifecycle logic was repeated | Partly fixed by safe scope | Pure refresh-token plausibility validation is shared. Media paths retain different authorization policy and were not hidden behind a generic auth abstraction. Fable should review remaining repetition. |
| 21 | Four stale and two unresolved feeds needed investigation | Partly fixed, provider work deferred | Refresh code no longer fabricates freshness. Feed names and provider blockers remain explicit below. |
| 22 | Latest visible GitHub CI failure needed investigation | Blocked for remote diagnosis | Run `31384003680` failed, but `gh-axi run view --log-failed` returned `NOT_FOUND`. Local equivalents passed where prerequisites existed. |
| 23 | High-risk lint warnings needed cleanup | Partly fixed | Lint has zero errors. Twenty-nine complexity warnings remain for later focused cleanup. |
| 24 | OG edge route reached Node filesystem code | Fixed for OG route | `lib/ogBrandEdge.tsx` isolates edge-safe constants. The production build generated 493 pages. Any unrelated edge warning needs a separate owner. |

## Implemented changes

### Security and privacy

#### Legal disclosure

`[app/privacy/page.tsx](app/privacy/page.tsx)` and `[app/terms/page.tsx](app/terms/page.tsx)` now match the real data paths.

- OpenAI processing is disclosed for Social and profile images, message attachments, and venue-wall images.
- Social adult access is described accurately. A stored date of birth decides when present. When no date of birth answers the question, one recorded self-assertion can satisfy the adult gate. An under-18 or invalid stored answer still refuses access. The self-assertion is not a general capability.
- Device account management is described as local storage for up to five account records. Records can contain account id, refresh token, email, handle, and activity timestamps. The purpose is account switching and session recovery. Records remain until sign-out, explicit removal, or device eviction under the account controls.
- Favourite drink, interests, and workplace are public profile fields. Email, date of birth, gender, and full legal name remain private.

#### Social access and message opening

- `[app/api/social/access/route.ts](app/api/social/access/route.ts)` uses the explicit no-resume-cookie path for GET requests. A cross-site top-level GET cannot rotate and discard `pubmax_resume`.
- `[app/api/messages/route.ts](app/api/messages/route.ts)` applies the durable limiter before opening a conversation. It normalises handle variants, requires a live claimed recipient, and fails closed when the limiter or recipient read cannot prove safety. Unknown handles do not create durable open rows.
- Regression tests cover attacker origins, bearer access, mixed-case identifiers, unknown recipients, and concurrent open attempts.

#### Private media delivery

- `[app/api/social/media/[mediaId]/route.ts](app/api/social/media/[mediaId]/route.ts)` performs current actor, consent, relationship, and limiter checks before reading private media.
- The route streams the object with private no-store semantics. It does not return a reusable signed storage URL or a cacheable redirect.
- Relationship changes are tested. Blocking or unfriending a viewer prevents the next request even when the viewer retained an earlier route target.

#### Dependencies, CSP, and shared policy

- `posthog-js` is upgraded to `^1.415.1`.
- `dompurify` is constrained to `3.4.13` to address GHSA-55q2-fjhq-7xh7 through the dependency tree.
- `uuid` is constrained to `11.1.1`.
- `[lib/refreshTokenPolicy.ts](lib/refreshTokenPolicy.ts)` owns the pure plausibility check used by browser refresh-token lanes. Cookie, local-storage, session, and rotation policy remain in their domain owners.
- `[proxy.ts](proxy.ts)` keeps CSP exceptions narrow. Nonce routes do not receive the broad `unsafe-inline` allowance. Existing Next rendering and map behaviour remain covered by tests.
- `[scripts/extract_pint_prices.py](scripts/extract_pint_prices.py)` reads bounded first-party sitemap location text without handing fetched XML to an entity-resolving parser.
- `[lib/ogBrandEdge.tsx](lib/ogBrandEdge.tsx)` keeps filesystem font loading out of the edge OG import graph.

### Wanted vertical slice

The implementation follows `[docs/prd/SOCIAL_NIGHT_OS_VISION_PRD.md](docs/prd/SOCIAL_NIGHT_OS_VISION_PRD.md)`.

- `[lib/wantedResolve.server.ts](lib/wantedResolve.server.ts)` resolves supported Reel, TikTok, and YouTube URLs through licensed public metadata or oEmbed paths.
- URL handling accepts HTTPS only, rejects unsupported hosts and unsafe URL forms, bounds response size, applies timeouts, revalidates or rejects redirects, and parses only safe metadata fields. No caller-supplied URL reaches an open fetch path without the allowlist.
- Wanted records support optional drink interest and `private`, `mutuals`, or `crew:<id>` visibility.
- Owner checks run before mutations. Mutual and Crew reads require the relevant server-owned relationship. Forged Crew ids and foreign owner actions fail closed.
- Crew and Soft Plan actions are included in the route and UI vertical slice.
- `[supabase/migrations/20260810210000_0104_wanted_privacy.sql](supabase/migrations/20260810210000_0104_wanted_privacy.sql)` and its rollback define the privacy boundary. Captain application is still required before a production deploy.

### Responsive UI, accessibility, and product metadata

- `[components/map/MapPriceControl.tsx](components/map/MapPriceControl.tsx)` now has the mobile interaction path and auto-collapse behaviour.
- 320 pixel Map chips preserve whole place names and do not clip the control.
- Signed-out Social presents a useful sign-in path instead of a dead end.
- Plan first-screen fields remain visible at mobile widths without redundant helper copy.
- `[components/social/peopleDirectory.css](components/social/peopleDirectory.css)` uses container-aware sizing and a one-column narrow rail so names do not render character by character at 1440 pixels.
- `[components/city/CityChooser.tsx](components/city/CityChooser.tsx)`, `[components/landing/LandingPage.tsx](components/landing/LandingPage.tsx)`, and `[components/landing/ThamesHero.tsx](components/landing/ThamesHero.tsx)` use matching `aria-controls` targets and accessible names.
- `[app/social/social.css](app/social/social.css)` and `[components/a11y/skipLink.css](components/a11y/skipLink.css)` use semantic project tokens.
- `[public/manifest.webmanifest](public/manifest.webmanifest)` uses `PUBMAXX` for the installed name and supported metadata.

### Freshness, telemetry, and honesty

- `[app/api/map-search/route.ts](app/api/map-search/route.ts)` uses a bounded serverless completion boundary for telemetry. A telemetry failure does not fail the user response and does not include user data in logs.
- `[app/api/cron/refresh-whats-on/route.ts](app/api/cron/refresh-whats-on/route.ts)` writes a freshness stamp only when the source supplies a valid observed time that is not in the future. Request time is not treated as source evidence.
- Stale and unresolved feeds remain explicit. No new row, price, or timestamp was fabricated to make validation look green.

## Related work found in other threads

This section is context for Fable. It does not claim that separate work is part of implementation commit `102a2f431`.

### Growth and activation thread

The separate growth work shipped as PR [#1007](https://github.com/karanmrn/pubmax/pull/1007), merged on 2026-08-10 at 20:49 UTC. GitHub reported one passed check and zero failed checks for that PR. Its body recorded these changes:

- Enforce free-text access, numeric budget, and transport constraints through grounded Plan selection.
- Send Tonight Agent requests through completed Plan intake.
- Offer a saved usual Crew from the one-time morning recap without putting names in URLs or analytics.
- Add Islington as the fifth seed-borough evidence campaign row.
- Keep unsupported hard constraints fail closed.
- Keep private Crew names out of URLs and analytics.

That PR recorded 91 targeted planner tests, 10 targeted morning-recap tests, and 8 targeted borough tests. Its full CI and production visual checks were left unchecked because the isolated worktree fell below the agreed 500 MiB disk safety floor. Fable should review that PR separately and should not use its targeted counts as proof for this branch.

### Product research direction

The other thread identified the strongest product position as: “Where should our group go tonight?” The recommended product loop is:

```text
Choose venue -> share Crew plan -> complete night -> save private memory
-> contribute evidence -> optionally publish Story -> improve discovery
-> plan next night
```

The research supports these review principles:

- Price attracts attention. Vibe, weather, accessibility, planning, and getting home create repeat utility.
- PUBMAXX can build an evidence moat from original price, access, route, event, heritage, and visit data.
- Avoid thin local SEO pages and scaled content without original evidence.
- Keep Map, evidence, basic planning, Crew joining, and contribution free while repeat utility is tested.
- Test paid value only after repeat utility exists. Never sell venue rankings.
- Reward discovery, evidence, Crew coordination, memories, alcohol-free choices, and safe journeys. Never reward pint count, speed, units, or drinking streaks.

These are product direction notes for Fable. They are not a claim that every recommended slice is in this repair branch.

## Verification executed

All output was kept local or outside committed source. Secrets, private media, refresh tokens, signed URLs, and user data were not copied into this document.

### Repository gates

| Command | Result |
|---|---|
| `npm ci` | Passed. 601 packages installed and 602 packages audited. |
| `npm run validate-data` | Completed. 18 feeds valid, 4 stale, and 2 unresolved. The stale and unresolved states are reported below. |
| `npm run lint` | Passed with zero errors. 29 complexity warnings remain. |
| `npm run typecheck` | Passed. |
| `npm test -- --maxWorkers=2 --reporter=dot` | Passed. 996 test files and 10,245 tests passed. |
| `npm run coverage` | Passed. Approximate final coverage: 78.6% statements, 71.4% branches, 82.9% functions, and 82.5% lines. |
| `npm run test:rls` | Passed with local PostgreSQL and PostgREST. 3 files and 105 tests passed. |
| `NEXT_DIST_DIR=.next-prod npm run build` | Passed. 493 pages generated. OG edge import boundary is covered by `ogEdgeRuntime` tests. |

### Focused regression and feature tests

The full test run includes these focused suites. They were also used during red, green, and final verification checkpoints:

- `legalPages.test.ts`
- `socialAccessResumeCsrf.test.ts`
- `socialAccessRoute.test.ts`
- `messagesRoute.test.ts`
- `socialPostMediaRoute.test.ts`
- `socialReadProtectionRoutes.test.ts`
- `dependencySecurity.test.ts`
- `deviceAccountSessions.test.ts`
- `wantedResolve.test.ts`
- `wanted.test.ts`
- `wantedRoute.test.ts`
- `wantedStore.test.ts`
- `wantedPrivacyMigration.test.ts`
- `mobileMapPriceChrome.test.ts`
- `mobileChromeFit.test.ts`
- `peopleDirectoryRender.test.ts`
- `landingA11yWiring.test.ts`
- `semanticTokenUsage.test.ts`
- `mapSearchRoute.test.ts`
- `manifestBrand.test.ts`
- `refreshWhatsOnCron.test.ts`
- `ogEdgeRuntime.test.ts`

### Browser checks

Targeted Chromium checks covered desktop and 320, 390, and 430 pixel mobile paths. The affected set passed 13 tests using:

```sh
PW_SKIP_WEBSERVER=1 npm run test:e2e -- --project=chromium --workers=1 e2e/profile-hero-desktop.spec.ts e2e/mobile-plan-opening-layout.spec.ts e2e/mobile-map-chrome-fit.spec.ts --grep 'desktop profile|phone profile|Plan opening screen|one bar sharing|whole place name|recorded map journey'
```

The broader E2E run had 44 tests: 28 passed and 16 failed. The failures were existing stale assertions and keyless Supabase Social-store blocks, not a reason to claim the broad suite is green. Fable must review and rerun the broad suite in an environment with current assertions and required browser services.

Browser review covered:

- Social narrow context rail at 1440 pixels.
- Map controls and chip text at 320 pixels.
- Plan first screen at 390 pixels.

### Security and dependency checks

| Check | Result |
|---|---|
| `npm audit --audit-level=moderate` | Passed with zero reported vulnerabilities. |
| `npm audit --omit=dev --audit-level=moderate` | Passed with zero reported production vulnerabilities. |
| `node scripts/resilient-audit.mjs` | Passed. No high or critical vulnerabilities. |
| OSV lockfile scan | Passed with zero findings. Final output: `/tmp/pubmax-audit-final-20260810/osv-lock-final.json`. |
| Semgrep security scan | Zero findings in the final scoped scan. Five parser or timeout warnings were recorded in `/tmp/pubmax-audit-final-20260810/semgrep-security-final.json`. |
| Gitleaks current source and tree scan | Zero findings. |
| Gitleaks branch-history scan | 43 inherited, redacted historical findings. No new current-tree secret was identified. Fable must keep history remediation separate from this code repair. |
| CycloneDX SBOM | Final artifacts were generated outside source: 707 components for full dependencies and 189 for production dependencies. Both use CycloneDX 1.5. |
| Safe local load test | 30 local GET navigations completed with zero failures. Approximate p50 1051 ms, p95 1510 ms, and p99 1617 ms. |

The audit artifacts remain outside the repository under `/tmp/pubmax-audit-20260810` and `/tmp/pubmax-audit-final-20260810`.

The bounded load script was also used for read-only production navigation probes. It used 1, 5, and 10 users over `/`, `/social`, and `/tonight`, for 3, 15, and 30 page navigations. All probes had zero navigation failures. The 5 and 10 user probes returned expected rate-limit responses, which confirmed that limits remained active. These were passive GET checks only. No production write, account action, media upload, migration, or stress run was performed.

Local load command:

```sh
BASE_URL=http://localhost:3100 USERS=5 ITERATIONS=2 PATHS=/,/social,/tonight node /tmp/pubmax-audit-20260810/playwright-load.mjs
```

Read-only production probe commands:

```sh
BASE_URL=https://pubmaxxing.com USERS=1 ITERATIONS=1 PATHS=/,/social,/tonight node /tmp/pubmax-audit-20260810/playwright-load.mjs
BASE_URL=https://pubmaxxing.com USERS=5 ITERATIONS=1 PATHS=/,/social,/tonight node /tmp/pubmax-audit-20260810/playwright-load.mjs
BASE_URL=https://pubmaxxing.com USERS=10 ITERATIONS=1 PATHS=/,/social,/tonight node /tmp/pubmax-audit-20260810/playwright-load.mjs
```

## Blocked and deferred items

### Data freshness

`npm run validate-data` reported these states. They are not hidden or replaced with fabricated timestamps:

- Stale: `price_updates`, `drink_price_updates`, `weather`, and `whats_on`.
- Unresolved: `price_update_retrieval` and `night_signal_candidates`.

The confirmed code defect in the Whats-On cron path was fixed: request time no longer advances source freshness when the provider does not supply an observed time. Provider credentials, source availability, or a separate scheduler repair are still required for fresh data.

### GitHub CI evidence

The latest visible failed main run was `31384003680` for `fix(design): the front door, measured at both viewports (#1000)`. Its RLS companion was `31384003667`. The run log lookup returned `NOT_FOUND`, so this branch does not claim to know the remote failure cause. Local lint, typecheck, test, RLS, build, and targeted browser checks are the current equivalent evidence.

### Lint and static analysis

- Lint has zero errors but 29 complexity warnings. These need focused cleanup without broad churn.
- Final Semgrep had zero findings but five parser or timeout warnings. The scan did not prove files that were not parsed.
- Current-tree Gitleaks is clean. Historical findings require repository history policy and credential-owner decisions.

### Database migration

Migration `0104_wanted_privacy.sql` and its rollback are in the branch. Captain must apply and verify the migration in isolated staging before any production deploy. This task did not apply it to production.

### Broad E2E and environment

The affected targeted browser set passed. The broad suite is not green because it still contains stale assertions and keyless Supabase Social-store paths. Fable should not convert the targeted result into a full release claim.

## Fable review checklist

- [ ] Review `102a2f431` against all 24 findings and this PRD.
- [ ] Inspect every auth, ownership, relationship, cookie, CSRF, RLS, media, upload, cache, and logging path touched by the commit.
- [ ] Confirm GET Social access cannot redeem or rotate refresh credentials.
- [ ] Confirm message limits run before durable writes and unknown handles cannot create rows.
- [ ] Confirm private media authorization runs on every request and response caching is private and disabled.
- [ ] Confirm Wanted URL resolution cannot reach private networks, unsafe hosts, unbounded bodies, or unsafe redirects.
- [ ] Confirm the DOMPurify fix is in the lockfile and no audit waiver hides it.
- [ ] Confirm the CSP exception scope is still required by current Next rendering.
- [ ] Review the four stale and two unresolved feeds with data owners.
- [ ] Rerun broad Chromium E2E with current assertions and required local services.
- [ ] Resolve or accept the 29 complexity warnings with owners.
- [ ] Apply migration `0104` only through the captain-controlled staging process.
- [ ] Decide separately whether to merge, deploy, or open a pull request. This task only pushes the review branch.

## Acceptance criteria

Fable can approve this review handoff when:

1. The implementation commit and this document are visible on the pushed branch.
2. Fixed items have regression tests and no weakened authentication, authorization, RLS, CSP, rate-limit, or privacy controls.
3. Verification results distinguish passed, partial, blocked, and deferred work.
4. No data freshness, price, social relationship, or user identity claim is fabricated.
5. Production migration, deployment, and data mutation remain blocked until the listed owners complete their checks.

## Key files

- [Weekend audit repair plan](docs/superpowers/plans/2026-08-10-weekend-audit-repair.md)
- [Social Night OS vision PRD](docs/prd/SOCIAL_NIGHT_OS_VISION_PRD.md)
- [Fable review iteration plan](docs/plans/FABLE_REVIEW_ITERATION.md)
- [Crew Night Loop plan](docs/plans/CREW_NIGHT_LOOP.md)
- [Privacy page](app/privacy/page.tsx)
- [Terms page](app/terms/page.tsx)
- [Social access route](app/api/social/access/route.ts)
- [Message route](app/api/messages/route.ts)
- [Private Social media route](app/api/social/media/[mediaId]/route.ts)
- [Wanted policy](lib/wanted.ts)
- [Wanted resolver](lib/wantedResolve.server.ts)
- [Refresh-token policy](lib/refreshTokenPolicy.ts)
- [Edge OG brand module](lib/ogBrandEdge.tsx)
- [Wanted privacy migration](supabase/migrations/20260810210000_0104_wanted_privacy.sql)
