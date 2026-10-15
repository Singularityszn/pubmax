# GNHF closeout: open PR audit

GitHub snapshot: **2026-10-15 21:58:35 UTC**. Repository: [Singularityszn/pubmax](https://github.com/Singularityszn/pubmax/pulls).

This private report completes the audit subtask. It does not complete the product work or approve any merge or release.

## Inventory and evidence limits

The fresh inventory contains 16 open PRs, including four drafts. The hosted rollups show 11 SUCCESS, four PENDING, and one FAILURE.
GitHub records no aggregate review decision or assignee for any PR. Submitted reviews are COMMENTED only. There are 13 unresolved review threads.

The table counts all returned check contexts, including external statuses. S means SUCCESS, K means SKIPPED, N means NEUTRAL, R means IN_PROGRESS, Q means QUEUED, and F means FAILURE.
Each CheckRun is attached to the recorded head in its check suite. This establishes hosted check attribution, not independent full or live acceptance.

Every PR skips the full browser suite, Macroscope Correctness, and Supabase Preview. Most also skip Macroscope Approvability and have neutral Cursor checks.
Both Vercel deployment contexts on every PR say `Canceled by Ignored Build Step`, despite their SUCCESS state. They provide no deployment proof.
The check links expose the full per-check names and results. A successful rollup does not mean that every configured check ran.

| PR | Exact head SHA | Draft | Rollup and context counts | Reviews at head / older | Unresolved / outdated | Merge state |
| --- | --- | --- | --- | --- | --- | --- |
| [#2073](https://github.com/Singularityszn/pubmax/pull/2073) | `0d90ab11340fed1e89444cfacf19d528577d3937` | No | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2073/checks) 20S 4K 2N | 0 / 1 | 2 / 0 | BLOCKED |
| [#2088](https://github.com/Singularityszn/pubmax/pull/2088) | `016b1133964ad7fded029c988f3bca8d99013735` | Yes | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2088/checks) 20S 3K | 0 / 0 | 0 / 0 | CLEAN |
| [#2089](https://github.com/Singularityszn/pubmax/pull/2089) | `4ba9a6c8f0158a1017766a782825cd232ac483fb` | Yes | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2089/checks) 20S 3K | 0 / 0 | 0 / 0 | CLEAN |
| [#2090](https://github.com/Singularityszn/pubmax/pull/2090) | `e6efcc2e6d4e193aed1599cebcc3fb31e53c5dc5` | Yes | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2090/checks) 21S 3K | 0 / 0 | 0 / 0 | DIRTY |
| [#2091](https://github.com/Singularityszn/pubmax/pull/2091) | `1ee21d904a309f258fe3726e3b41f3ba21dab65c` | No | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2091/checks) 20S 4K 2N | 1 / 0 | 2 / 0 | BLOCKED |
| [#2093](https://github.com/Singularityszn/pubmax/pull/2093) | `a4fa0e0cea25c968de1694a7d6898f922ca893fe` | No | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2093/checks) 20S 4K 2N | 1 / 0 | 1 / 0 | BLOCKED |
| [#2094](https://github.com/Singularityszn/pubmax/pull/2094) | `e9c4778dddd5e740ac2cbe16386b618d41cdc3e2` | No | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2094/checks) 20S 4K 1N | 0 / 1 | 1 / 0 | DIRTY |
| [#2095](https://github.com/Singularityszn/pubmax/pull/2095) | `994691bfa7baf307b4ea4a268406c0b8653982ee` | Yes | [PENDING](https://github.com/Singularityszn/pubmax/pull/2095/checks) 19S 3K 1R | 0 / 2 | 1 / 1 | BLOCKED |
| [#2099](https://github.com/Singularityszn/pubmax/pull/2099) | `69728667f697cef761d1a5745c122c2f110e3a46` | No | [PENDING](https://github.com/Singularityszn/pubmax/pull/2099/checks) 19S 4K 2N 1R | 0 / 3 | 0 / 0 | UNSTABLE |
| [#2100](https://github.com/Singularityszn/pubmax/pull/2100) | `6620321abd3cb075dd62b38e33de605037d319e2` | No | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2100/checks) 20S 4K 2N | 0 / 6 | 1 / 0 | BLOCKED |
| [#2102](https://github.com/Singularityszn/pubmax/pull/2102) | `e707808116c06d578f780558b3c9802cf96aea0b` | No | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2102/checks) 20S 4K 2N | 2 / 0 | 1 / 0 | BLOCKED |
| [#2103](https://github.com/Singularityszn/pubmax/pull/2103) | `4fe7c45d17250df496b7ad5b907efb24b789a13a` | No | [PENDING](https://github.com/Singularityszn/pubmax/pull/2103/checks) 18S 4K 2N 2R | 0 / 2 | 0 / 0 | UNSTABLE |
| [#2104](https://github.com/Singularityszn/pubmax/pull/2104) | `e0a129ebb8bb5f98f740b43aec0ab6785894e293` | No | [FAILURE](https://github.com/Singularityszn/pubmax/pull/2104/checks) 16S 4K 2N 3Q 1F | 0 / 0 | 0 / 0 | UNSTABLE |
| [#2105](https://github.com/Singularityszn/pubmax/pull/2105) | `a11b11fa0e09d51a36e2d648b3f1c11e983d32eb` | No | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2105/checks) 20S 4K 2N | 1 / 0 | 1 / 0 | BLOCKED |
| [#2106](https://github.com/Singularityszn/pubmax/pull/2106) | `00e3f53fc992cdf9f618c1689b26dc33b919decf` | No | [SUCCESS](https://github.com/Singularityszn/pubmax/pull/2106/checks) 20S 4K 2N | 0 / 0 | 0 / 0 | CLEAN |
| [#2107](https://github.com/Singularityszn/pubmax/pull/2107) | `7b292b49798cc1386cb936aad8fc06b384b7b248` | No | [PENDING](https://github.com/Singularityszn/pubmax/pull/2107/checks) 16S 4K 2N 4Q | 1 / 0 | 3 / 0 | BLOCKED |

The outdated count is a subset of unresolved threads. An outdated thread still requires a disposition. CLEAN does not establish merge eligibility.

## Scope, ownership, and next actions

### #2073: test(e2e): correct Core Web Vitals sweep measurements

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2073) | [3 changed files](https://github.com/Singularityszn/pubmax/pull/2073/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2073/checks)

The three files change the CWV driver, its browser suite, and performance rules.

The original performance owner is `01a1221b-f805-78e1-82c3-4eeb27d73308`. Receipt `1792100742-Pw3WJu` identifies that role. Receipt `1792100811-UtkI7Z` records its next supported gate.

Historical formal acceptance failed. Six driver scenarios do not establish the final five-pair performance result. Two unresolved findings concern restored Layers state and an unbounded canvas focus wait.

The existing owner must reconcile both findings at the current source. Its supported gate and candidate H remain unbound. Final composition, full verification, and a separately admitted quiet five-pair run remain required.

Open findings: [e2e/helpers/webVitals.ts](https://github.com/Singularityszn/pubmax/pull/2073#discussion_r4217690932), [e2e/helpers/webVitals.ts](https://github.com/Singularityszn/pubmax/pull/2073#discussion_r4217690938).

### #2088: Use temporary read-only backup logins and bound retention

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2088) | [9 changed files](https://github.com/Singularityszn/pubmax/pull/2088/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2088/checks)

Nine files cover backup retention, temporary database logins, photo synchronisation, PostgreSQL fixtures, and the disaster recovery runbook.

The existing backup owner is `01a1221e-de2b-7160-845c-7a3d6e17e097`, identified in receipt `1792100742-Pw3WJu`.

The published head can overwrite a retained photo before a later Storage download fails. [The reproduction](https://github.com/Singularityszn/pubmax/pull/2088#issuecomment-6153301114) is a merge blocker. Hosted fixture success does not prove backup durability. Scheduling, a production backup, and restore acceptance remain unproved.

The existing owner must validate and publish its staged-photo repair through its original route. Receipt `1792100742-Pw3WJu` reports unpublished `5cc39fa60` with 77 focused tests. That receipt does not repair the published SHA. Current-main reconciliation, full validation, and runtime acceptance remain required.

### #2089: Keep map venue lists aligned with camera movement

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2089) | [2 changed files](https://github.com/Singularityszn/pubmax/pull/2089/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2089/checks)

The two files are `components/PubMapCanvas.tsx` and `e2e/map-accessibility.spec.ts`. They align open venue lists with camera movement and update browser interactions.

The existing map/native owner is `01a1225a-d46e-70d3-a426-76a9fb6f3e9b`, identified in receipt `1792100742-Pw3WJu`.

The PR body records source-only validation at this head. Browser, production, and physical acceptance did not run there. Receipt `1792100742-Pw3WJu` still reports Test inconclusive at 13/22. Native Filters paint, current-source iPhone, physical Android, WebView 140+, and sandbox notification delivery remain gaps.

The existing owner must complete its original Test route and fresh head-bound validation. Historical screenshots and green hosted checks do not complete those device criteria.

### #2090: Snapshot performance candidate e6efcc2e for review

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2090) | [182 changed files](https://github.com/Singularityszn/pubmax/pull/2090/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2090/checks)

The 182 files include 60 unit-test files, 49 component files, 27 library files, 16 E2E files, 11 app files, and 11 documentation files. Other changes cover configuration, skills, and CI.

The original performance owner retains this snapshot and PR #2073, as the PR body explicitly states. Receipt `1792100742-Pw3WJu` identifies the owner thread.

This is a review snapshot with merge conflicts. Its body records Plan readiness above both ceilings and inconclusive Native validation. Receipt `1792100811-UtkI7Z` records an unbound final candidate H and unresolved hydration-retry and restored-sheet findings at their reviewed pins.

The existing owner must inspect its genuine supported gate after supervisor admission and reconcile Main, Profile, Launch, Doc, and dependency inputs. Keep this snapshot a draft. Full verification, final-source runtime acceptance, and the unchanged formal five-pair result remain required.

### #2091: fix: restore iPhone email returns and You-tab session identity

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2091) | [59 changed files](https://github.com/Singularityszn/pubmax/pull/2091/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2091/checks)

The 59 files cover browser auth, identity navigation, native email/provider returns, six iOS files, release ordering, documentation, and tests.

The original Profile owner retains this work. Receipt `1792100826-48Q93O` records its same-head preparation and supported next action. No ownership inference uses the PR author.

Two unresolved threads concern native email guard messages and query-preserving redirect proof. The body records 27/34 live scenarios and seven external gaps. Signed original-bundle runtime, physical Mail and provider returns, native menus, and production release remain unproved. Its risk statement still warns about cancellation persistence.

The existing owner must reproduce and resolve the prepared message, redirect, and unread-response findings after admission. It must then complete head-bound verification and signed-source readiness. Original-account iPhone acceptance requires human taps after the release owner's separately gated release.

Open findings: [components/auth/AuthProvider.tsx](https://github.com/Singularityszn/pubmax/pull/2091#discussion_r4268002997), [docs/SOFT_LAUNCH_CHECKLIST.md](https://github.com/Singularityszn/pubmax/pull/2091#discussion_r4268003017).

### #2093: docs: add launch status and Claude handoff in opus55.md

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2093) | [1 changed files](https://github.com/Singularityszn/pubmax/pull/2093/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2093/checks)

Only `opus55.md` changes.

The original Launch/Doc owner retains the publication. The PR intent links thread `01a133fc-9721-78d2-a149-ea209fa47228` and preserves its original publication custody.

The unresolved [privacy review](https://github.com/Singularityszn/pubmax/pull/2093#discussion_r4272185527) requires opaque labels for personal paths and operational identifiers. Validation is no-surface. It establishes no live product acceptance.

The existing Doc owner must redact the public handoff, preserve restricted provenance, resolve the finding, and complete the configured final-head document checks. Product acceptance remains with the product owners.

Open findings: [opus55.md](https://github.com/Singularityszn/pubmax/pull/2093#discussion_r4272185527).

### #2094: fix: improve map navigation, menu evidence, and Pub Pal recovery

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2094) | [492 changed files](https://github.com/Singularityszn/pubmax/pull/2094/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2094/checks)

The 492 files cover map and account UI, Pub Pal menus and voice, imported data, privacy tooling, dependencies, skills, and tests. The scope includes 282 public files, 78 unit-test files, 41 component files, and 33 library files.

The original Launch owner is `01a133fc-9721-78d2-a149-ea209fa47228`. The PR's original run matches the explicit owner in receipt `1792100996-azUjFW`.

The published PR has merge conflicts and one unresolved deterministic-first-turn conversation-ID finding. Its body records 29/37 live scenarios. Real accounts, configured provider turns and audio, owner replay, provider privacy state, live transit, devices, and formal performance remain unproved.

The existing owner needs scoped supervisor disposition for its unpublished Source240 review finding. Receipt `1792100996-azUjFW` reports `f3ab85105fd0e20c4798b3bb1f4f79405a022b36`, 1,643 focused passes, and full/private/browser proof pending. It also reports complete family release. The mixed event/menu tool substitution is source-derived, not a new runtime reproduction. Neither that source nor its proof transfers to this published SHA.

Open findings: [lib/palElevenLabsChat.server.ts](https://github.com/Singularityszn/pubmax/pull/2094#discussion_r4273122899).

### #2095: fix: preserve planner constraints, onboarding choices, and Lore citations

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2095) | [109 changed files](https://github.com/Singularityszn/pubmax/pull/2095/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2095/checks)

The 109 files cover planner constraints, onboarding continuity, Lore citations, and proof records. There are 86 documentation files, nine unit-test files, eight library files, three E2E files, and two component files.

The existing owner is `01a13e7b-9261-7603-b49f-4c60a9038f2e`, explicitly identified in receipt `1792100742-Pw3WJu`.

One unresolved, outdated thread concerns generic food-price wording. [The latest owner update](https://github.com/Singularityszn/pubmax/pull/2095#issuecomment-6202395364) reports 37,022 tests, 564 database checks, and 219 private constraint cases. It explicitly leaves final independent verification, CI, and requested review pending. Device, authenticated provider, privacy, retention, and release proof remain separate.

The existing owner must finish independent verification of visible price labels and close or substantiate the remaining thread. Complete Browser layout pins (1/3) and the requested review at the final head. Preserve draft status until the recorded gates clear.

Open findings: [lib/planGeneration.server.ts](https://github.com/Singularityszn/pubmax/pull/2095#discussion_r4282562254).

Current incomplete or failed checks: [Browser layout pins (1/3)](https://github.com/Singularityszn/pubmax/actions/runs/38806573446/job/116668856471) IN_PROGRESS.

### #2099: perf(map): loading bundle - revision-skew hardening, pins during flight, p99 field timing

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2099) | [10 changed files](https://github.com/Singularityszn/pubmax/pull/2099/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2099/checks)

The current ten-file diff covers revision-skew recovery, error reporting, rules, and four unit-test files. The body describes a bundle containing #2100 and #2104. That narrative does not enlarge the current changed-file list.

Owner unknown. The inspected PR has no assignee or explicit accountable owner. Its linked task names are implementation provenance.

Both review threads are resolved. The body still requires a full local no-mistakes run for the composed bundle. Earlier PostgreSQL, full verify, browser, route-budget, real-basemap, and live analytics limitations are not cleared by the pending hosted rollup.

The supervisor must identify the existing accountable owner. That owner must reconcile the bundle's actual source composition with #2100 and #2104, complete the running browser shard, and bind full validation and acceptance to the final bundle SHA.

Current incomplete or failed checks: [Browser layout pins (2/3)](https://github.com/Singularityszn/pubmax/actions/runs/38808272939/job/116674687449) IN_PROGRESS.

### #2100: feat(map): report field time-to-pins as one map_load_timing event per visit

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2100) | [13 changed files](https://github.com/Singularityszn/pubmax/pull/2100/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2100/checks)

The 13 files add map timing collection and sanitisation, the hook, PostHog handling, analytics documentation, privacy copy, and a regression suite.

Owner unknown. The body links implementation session `session_01NE75d49oCtWq6Gv18cRt1y`. That link does not establish continuing ownership.

One unresolved thread concerns abandonment during SDK loading. Its response documents an undercount rather than adding another transport. The body records mocked SDK tests and local PostgreSQL/full-verify limits. It explicitly lacks live PostHog proof.

The supervisor must identify the existing owner. That owner must obtain a recorded disposition for the abandonment limit, complete the required final-head verification, and distinguish consented field delivery from mocked transport proof.

Open findings: [lib/posthogClient.ts](https://github.com/Singularityszn/pubmax/pull/2100#discussion_r4286980283).

### #2102: perf(sw): navigation preload and a stalled-shell timeout for navigations

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2102) | [2 changed files](https://github.com/Singularityszn/pubmax/pull/2102/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2102/checks)

Only `public/sw.js` and `__tests__/serviceWorkerCache.test.ts` change. They add navigation preload and a four-second timeout for eligible cached shells.

Owner unknown. The body links implementation session `session_01NA77yPubWs5s1FLE7Zg4NA`. It does not assign continuing ownership.

The unresolved review disputes adding overlapping Date and Age values. The response retains a conservative early-refusal trade-off and explicitly hands it to the PR owner. Unit coverage does not prove live CDN behaviour or the proposed p99 cause. Local database checks were not run.

The supervisor must identify the existing owner. That owner must settle the HTTP-age trade-off, validate actual preload and cache behaviour at the final head, and retain the separate live performance limit.

Open findings: [public/sw.js](https://github.com/Singularityszn/pubmax/pull/2102#discussion_r4287061474).

### #2103: perf(proxy): keep root public files and the PostHog relay off the proxy

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2103) | [7 changed files](https://github.com/Singularityszn/pubmax/pull/2103/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2103/checks)

Seven files change proxy matchers, shared static-file rules, Clerk bypass, the CSP contract, two unit-test suites, and one E2E selector.

Owner unknown. No inspected assignment or explicit ownership statement identifies an accountable owner.

The review thread is resolved. Two browser checks remain in progress. The body leaves post-release header and invocation-count evidence pending. The separate proposal for five cached documents was explicitly deferred and has no established owner in this audit.

The supervisor must identify the existing owner. That owner must finish current browser checks and final-head validation. The release owner can later collect the authorised live header and invocation evidence. Do not claim the deferred document change is assigned or completed.

Current incomplete or failed checks: [Browser layout pins (1/3)](https://github.com/Singularityszn/pubmax/actions/runs/38807398586/job/116671681957) IN_PROGRESS, [Browser layout pins (2/3)](https://github.com/Singularityszn/pubmax/actions/runs/38807398586/job/116671681875) IN_PROGRESS.

### #2104: perf(map): reveal price pins during the opening arrival flight

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2104) | [6 changed files](https://github.com/Singularityszn/pubmax/pull/2104/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2104/checks)

Six files change the pin reveal coordinator and map wiring, its tests, the component rules, and the quality-floor browser readiness wait.

Owner unknown. The body links implementation session `session_01RwA4EoCoHfkY1nkh8qwAyz`. It does not establish ongoing ownership.

Browser layout pins (2/3) fails while three other browser checks are queued. [The failed job](https://github.com/Singularityszn/pubmax/actions/runs/38809537343/job/116678959466) remains a blocker. The body explicitly lacks real hardware against OpenFreeMap. Its interleaved lab uses SwiftShader and stubbed tiles, with PostgreSQL limitations.

The supervisor must identify the existing owner. That owner must diagnose the current failed job and complete the remaining checks without treating the earlier shard (3/3) readiness repair as this job's diagnosis. Real hardware and basemap evidence remain separate from the lab and #2099 bundle.

Current incomplete or failed checks: [Browser law pins](https://github.com/Singularityszn/pubmax/actions/runs/38809537343/job/116678959981) QUEUED, [Browser layout pins (1/3)](https://github.com/Singularityszn/pubmax/actions/runs/38809537343/job/116678959790) QUEUED, [Browser layout pins (2/3)](https://github.com/Singularityszn/pubmax/actions/runs/38809537343/job/116678959466) FAILURE, [Browser layout pins (3/3)](https://github.com/Singularityszn/pubmax/actions/runs/38809537343/job/116678959940) QUEUED.

### #2105: fix: clarify weather facts and Today navigation state

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2105) | [27 changed files](https://github.com/Singularityszn/pubmax/pull/2105/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2105/checks)

The 27 files change weather copy, Today fallback content, navigation state, rules, 17 unit-test files, and two E2E files.

Owner unknown. No inspected assignment or explicit ownership statement identifies an accountable owner.

The body reports seven local product scenarios. The unresolved review identifies nested cards in the hyped-pub fallback. Green CI does not close that UI finding or establish live deployment or device acceptance.

The supervisor must identify the existing owner. That owner must reproduce and resolve the nested-card finding, preserve the fallback semantics, and repeat the affected final-head UI proof.

Open findings: [app/today/TodayClient.tsx](https://github.com/Singularityszn/pubmax/pull/2105#discussion_r4287495598).

### #2106: perf(map): cut venue-selection INP and the venue panel's late jump

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2106) | [16 changed files](https://github.com/Singularityszn/pubmax/pull/2106/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2106/checks)

Sixteen files change venue-array identity, community-price identity, the closed list model, mobile sheet layout, regression tests, and six lab evidence files.

Owner unknown. The body links implementation session `session_01RRanhvw68y7XoV1vGuc1H6`. It does not establish continuing ownership.

No submitted reviews or review threads are present. The body records lab improvements with stubbed basemap tiles and SwiftShader. It explicitly omits the formal CWV sweep, local RLS, and Playwright suite. Reported remaining causes on other routes are outside this PR's fixes.

The supervisor must identify the existing owner. That owner must complete the required review and final-head browser validation. The performance owner must assess formal acceptance separately. Hosted RLS success is distinct from the omitted local run.

### #2107: fix: correct venue area and address identity

[PR body and discussion](https://github.com/Singularityszn/pubmax/pull/2107) | [308 changed files](https://github.com/Singularityszn/pubmax/pull/2107/files) | [Checks](https://github.com/Singularityszn/pubmax/pull/2107/checks)

The 308 files propagate venue locality and address display rules through app, map, search, route, and share consumers. They include 277 public files, nine library files, eight unit-test files, seven component files, three app files, and three builders.

Owner unknown. No inspected assignment or explicit ownership statement identifies an accountable owner.

Three unresolved findings concern persisted Hatton borough identity, locality values in the borough picker, and generic London locality overrides. The body both preserves Camden as an administrative decision and records that decision as conflicting with its acceptance criterion. Four browser checks remain queued.

The supervisor must identify the existing owner. The captain must settle the borough acceptance conflict. The existing owner must then align the data, API, filters, labels, and tests, address both locality regressions, and complete final-head CI and UI proof.

Open findings: [__tests__/venuePageReadUnavailable.test.tsx](https://github.com/Singularityszn/pubmax/pull/2107#discussion_r4288570636), [components/PubMap.tsx](https://github.com/Singularityszn/pubmax/pull/2107#discussion_r4288570641), [lib/venueDisplay.ts](https://github.com/Singularityszn/pubmax/pull/2107#discussion_r4288570643).

Current incomplete or failed checks: [Browser law pins](https://github.com/Singularityszn/pubmax/actions/runs/38810859694/job/116683414634) QUEUED, [Browser layout pins (1/3)](https://github.com/Singularityszn/pubmax/actions/runs/38810859694/job/116683415005) QUEUED, [Browser layout pins (2/3)](https://github.com/Singularityszn/pubmax/actions/runs/38810859694/job/116683414991) QUEUED, [Browser layout pins (3/3)](https://github.com/Singularityszn/pubmax/actions/runs/38810859694/job/116683414961) QUEUED.

## Supervisor reply and ownership limits

At **2026-10-15T21:58:48Z**, the supported receipts projection still shows request `gnhf-grokbot-unfinished-01a1418b` as announced, unacknowledged, and without a reply.
Its note ID is `1792101079-fImiwm`. The request was not resent. GrokBot identity and its supported contact path remain unconfirmed.

At **2026-10-15T21:57:00Z**, `ready` reports a held lock with a live harness at PID 599. The wake consumer is down with reason `stale-beacon`, and `can_receive=false`.
This does not prove that the supervisor thread is dead or transfer its authority.

The supported receipts provide the ownership and continuation evidence cited above:

- `1792100742-Pw3WJu`, acknowledged with reply cursor `000000000324`, identifies the Backup, Map/Native, Performance, and #2095 owners.
- `1792100811-UtkI7Z`, acknowledged with reply cursor `000000000325`, records Performance prerequisites and the unbound candidate.
- `1792100826-48Q93O`, acknowledged with reply cursor `000000000326`, records Profile preparation and later physical-device requirements.
- `1792100996-azUjFW` reports the Source240 review finding and complete family release. Its follow-up notes `1792101259-Z6TZIb` and `1792101344-pOWN0r` still request disposition.

These are owner reports, not independent inspection of private source or proof artifacts. Earlier receipts calling Source240 active are superseded by its later release report.
The bounded receipts omit 448 older handled notes. This audit makes no claim about their contents and did not inspect private child state.

No repair task is clearly unowned on the inspected evidence. Owner unknown means that assignment is unconfirmed, not that the work is available.
The PR author, absent assignees, linked implementation sessions, and unfinished work do not establish availability for takeover.

## Collection and consistency check

The audit used `~/.local/bin/gh-axi` after reading its global, PR, and API help.
It enumerated open PRs with `gh-axi pr list -R Singularityszn/pubmax --state open --limit 100`.
Read-only GraphQL queries used `gh-axi api POST graphql --raw-field 'query=...' --full`. They contained queries only, with no mutations.

The queries read head SHAs, draft states, assignees, review decisions, submitted reviews, all review threads, complete bodies, all current comments, and head check contexts.
Every connection reached its end. Changed files were read in pages of 100, including all 492 files for #2094 and all 308 for #2107.
The final refresh rechecked all 16 heads, draft states, file counts, reviews, unresolved threads, and check results. No PR head changed during collection.
PR bodies can contain historical rounds. Their test claims remain attributed to their recorded sources rather than promoted to current acceptance.

Only the supported `fm-inbox.sh ready` and `receipts` projections supplied supervisor state. No supervisor message or lock operation occurred.

The worktree was clean before this report. Final checks compare every inventory row with the last command response and check the changed paths.
Only `outputs/gnhf-closeout-20261015.md` is added. No unrelated tracked file changes, staged changes, or other untracked files are present.
No build, test, installation, server, browser, pipeline, provider operation, commit, push, merge, issue closure, or publication occurred.

