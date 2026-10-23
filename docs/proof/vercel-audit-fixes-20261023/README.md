# Local Vercel audit repairs, 23 October 2026

Branch: `codex/vercel-audit-fixes-1023`.
Base: `d64a5cf0474407d51c7d2b521a7337c2c3f8c663`.

This dated record describes the combined source branch above. The
`codex/analytics-polling-pr-1023` split contains only its analytics and badge
changes, plus this record. Moderation, alert delivery, routing and hours-test
repairs belong to separate branches. The results below do not validate the
independent split.

At the recorded run, the source branch was local and had no deployment.
Production settings, databases, secrets, notification destinations, firewall
rules and DNS records stayed unchanged. Database proofs used throwaway local
clusters.

## Changes and evidence

| Area | Before | After | Evidence |
| --- | --- | --- | --- |
| Moderation | A missing OpenAI key returned a successful skip without a named configuration alert. | Deployed production emits a named error for each worker. Content remains pending and the response remains `200` skipped. | Both moderation route suites exercise the authenticated missing-key branch. Storage and transports are local doubles. |
| Alert delivery | The sink discarded HTTP refusals and network failures. | A safe `alert.delivery_failed` diagnostic records the category and optional HTTP status. The URL, payload and response body remain private. | Refused and rejected transport tests. Existing cooldown, hourly cap and no-throw tests remain. |
| Walking routes | Provider failures silently returned approximate geometry. Request cancellation stopped at the API boundary. Quota exhaustion had no webhook alert. | Provider errors record a safe category/status. Cancellation reaches the provider and cancelled requests skip quota. Quota exhaustion uses the existing alert sink. | Provider, API, budget and alert tests. A local HTTP request returns `source: "straight"` without a provider key. |
| Badge requests | Both navigation badges polled hidden tabs and started overlapping focus/timer reads. | Hidden tabs stop polling and abort pending reads. A visible return refreshes once. Pending reads combine repeated refreshes. Stale replies cannot overwrite a newer badge. | Both rendered badges under hidden, visible, pending, signed-out and late-response conditions. Existing message-read tests preserve immediate updates. |
| Mobile loading | Both Vercel SDKs mounted before consent and requested their scripts. | The SDKs load after consent. Withdrawal unmounts both, and `beforeSend` still checks every measurement. | Rendered consent-transition test and browser cases at 390px and 1280px. |

The routing cache already handles normal backend failures. The final change
uses that existing behavior instead of adding another cache fallback layer.
The budget exception test injects an unexpected collaborator failure. It does
not identify the cause of the eight provider failures observed in production.

## Mobile resource comparison

The two local production builds used `VERCEL=1`. Each browser visit had no
analytics consent. The viewport was 360px wide.

| Measurement | Before | After |
| --- | ---: | ---: |
| Vercel script requests before consent | 2 | 0 |
| Script resource entries | 26 | 23 |
| Encoded script bytes | 288,726 | 286,551 |
| Horizontal overflow | No | No |

The encoded-byte reduction is 2,175 bytes. This is a small resource saving.
The visits were unthrottled and ran on a shared computer. Their FCP values,
180ms and 192ms, do not establish a latency improvement. Production mobile
FCP, LCP and INP need new field measurements after an approved release.
No performance ceiling or baseline changed. The full Core Web Vitals sweep
and physical-device acceptance were not run for this local repair.

[Raw resource summary](mobile-resources.json).
[Before screenshot](before.png).
[After screenshot](after.png).

## Production work still required

| Audit finding | Disposition |
| --- | --- |
| A01 moderation backlog | The local code makes missing configuration visible. A valid production `OPENAI_API_KEY`, backlog inspection and controlled drain remain necessary. This work did not approve or remove queued content. |
| A02 alerts without destinations | The local sink diagnoses refused deliveries. The production webhook and Vercel notification destination still need configuration and a delivery check. |
| A03 failed walking provider | Safe diagnostics and cancellation are implemented locally. The live key, quota and provider response still require verification. The observed outage is not declared resolved. |
| A04 stale content | The freshness check still reports stale `area_news` and `google_places_content`. Three durable feeds cannot be measured without credentials. No timestamps or freshness budgets were changed. |
| A05 mobile performance | Initial analytics work is reduced. Field performance and the canvas interaction result remain unverified. A missing CLS sample is not a score of zero. |
| A06 request volume | Hidden and overlapping badge reads are reduced. This does not prove that all approximately 50,000 observed Supabase calls were unnecessary or eliminated. Existing collaboration polling remains visibility-gated. |
| A07 ledger caching | No public caching was added to privacy-dependent content. The observed low reuse needs a separate route-level trace. |
| A08 firewall blocks | The live rule remains unchanged. Browser tests used local ports and did not consume its production allowance. |
| A09 DNS recommendations | No records changed. The recommended Vercel targets need a separately approved DNS change and verification. |
| A10 duplicate domains | No domain or redirect settings changed. Canonical-host consolidation remains a production operation. |

## Test preparation repair

The full check exposed 25 failures in the existing hours evaluation after a
production build. Six supposedly unknown pubs now have copied Places hours.
The Crosse Keys uses the recorded Google source rather than its website
source. A clean checkout previously hid these observations until a build.

The evaluation now selects ten pubs with no hours across all three evidence
lanes. It retains two sourced schedules, including the actual Google source.
Vitest prepares the build-generated Places files before workers start. The
absence, invented-time and source checks remain strict. No runtime hours
policy, observation date, freshness budget or venue data changed.

## Verification

The configured browser run passed all 20 tests in 1.6 minutes. It built and
started the app through the repository's Playwright configuration. The run
used installed Chrome through a temporary configuration override because the
pinned Chromium executable was absent. No browser cache was changed.

The selected hours, Places reader/builder and documentation checks passed
all 171 tests. The cold test run started without the generated Places folder.
Global preparation recreated it before the workers read venue evidence.

Two read-only code reviews found no documented-standard violations or
behavioral findings. They reviewed the test-preparation repair separately.

`npm run verify` completed with exit code 0. It passed data validation,
ESLint, migrated-schema type comparison, TypeScript, ChatGPT map checks,
dead-code checks, coverage, PostgreSQL permission proofs, conditional-skip
checks, the install-script allowlist and the dependency audit.

| Check | Result |
| --- | --- |
| Unit suite | 2,103 files and 43,417 tests passed. One live Context.dev test skipped because its API key is absent. |
| Coverage | Statements 84.68%, branches 78.51%, functions 88.66%, lines 88.32%. All existing thresholds passed. |
| Database proofs | 75 files and 691 tests passed against throwaway PostgreSQL clusters. No database proof skipped. |
| Production build | Passed. The final browser build used the normal keyless Playwright environment and fake public authentication configuration. |
| Browser checks | All 20 passed. The earlier manual build lacked fake authentication settings, which explained its one failed sign-in-gate check. |
| Lint | Zero errors. Ten existing unused-variable and complexity warnings remain outside this change. |
| Dependency audit | No unwaived high or critical vulnerabilities. Existing development-only waivers remain. |
| Freshness | Exit code 0 with two advisory stale datasets and three unmeasurable feeds. These are not reported fresh. |

The full Core Web Vitals sweep, physical-device testing, live provider calls
and authenticated production journeys remain outside this local proof.

The full verification used the repository's restored-output wrapper:

```sh
PUBMAX_TRACKED_OUTPUTS=public/data NEXT_DIST_DIR=.next-verify-audit \
NODE_OPTIONS=--max-old-space-size=4096 \
node scripts/run-with-restored-next-env.mjs npm run verify
```

The browser run used these repository specs:

```sh
npx playwright test e2e/vercel-consent-loading.spec.ts e2e/smoke.spec.ts \
  --project=chromium --workers=1
```

For this machine, the run added a temporary Chrome configuration override,
`VERCEL=1`, `PW_PORT=6251`, `PW_NEXT_DIST_DIR=.next-e2e-audit`,
`PW_SKIP_KEYLESS_WEBSERVER=1` and `PUBMAX_TRACKED_OUTPUTS=public/data`.
The override preserved the repository's build and server environment.

The original run wrote local logs under `artifacts/vercel-audit-fixes/`.
Those logs are not included in this split. The retained
[check summary](checks.json) records counts and limits without private data.
