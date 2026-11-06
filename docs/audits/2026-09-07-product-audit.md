# Product audit, 7 September 2026

Status: active. Full verification passes at `9cc8c5336`. Complete browser and native acceptance remain open.

Branch: `codex/full-product-audit`. Starting commit: `30a8b98fe`. Latest integrated source: `9cc8c5336`. Last full-gate pass: `9cc8c5336`. No release clearance.
Checkout: `/Users/karanmanoharan/Documents/projects/pubmaxx-audit`.
Fresh normal and keyless production-mode builds passed, including TypeScript.
Latest local normal build: `9cc8c5336`. Last full-gate pass: `9cc8c5336`. Last accepted keyless build: `9d002ca85`.
Production version checked on 12 September: `6a759e0ac`.
The [live response](../../.lavish/product-audit/assets/after-sep12/production-version-refresh.json) confirms deployment identity only. Production journeys were not repeated in this check.
The [latest tested version record](../../.lavish/product-audit/assets/after-sep12/venue-detail-callers/manifest.json) identifies the served normal build.
The audit merged `origin/main` at `6a759e0ac` through `32690106a`.
It then merged minor dependency main `61f001e4a` through `be63292e0`.
`npm ci` completed at `ac40a445a`. The [install log](../../.lavish/product-audit/assets/npm-ci-minor.log) is retained.
That install used Next 16.3.4, Vitest and coverage 4.1.11, and xmldom 0.9.12.
Its esbuild 0.27.0 and Sharp 0.35.4 native WebP smoke checks passed.
The audit later merged main `5a7c6eb1e` through `819377e9c`, including paired Vitest 5 integration.
The [later install log](../../.lavish/product-audit/assets/npm-ci-vitest5.log) records a completed dependency installation.
Installed versions are Next 16.3.4, paired Vitest 5.0.0, Capacitor 8.5.1, and MapLibre 6.7.0.
Earlier native-tool checks retain their original dependency scope. The full browser suite and performance acceptance remain open.
Social discovery, galleries, receipt recovery, and map shield normalization are integrated in this freeze.
Coordinator PRs 1631 and 1632 remain part of the last verified live release. The audit freeze is local.

Review surface: [Portable audit report](../../.lavish/product-audit/index.html).
The report uses current PUBMAXX tokens and local fonts. It opens without a network connection.

## Current audit results

### Terms diagnostic interrupted by host sleep, 13 September

The exact `9cc8c5336` diagnostic completed 27 of 35 route records, then timed out loading Borough.
Terms was never reached. No Terms LCP element, resource timing or font-arrival evidence exists from this run.
The original Terms result, 912ms against 300ms, remains unresolved.

macOS records confirm clamshell sleep overlapped the run. Later timings are confounded by sleep and wake gaps.
Completed route records are retained observations, not a passed gate. The final breach assertion never ran.
The enclosing test allowed 219 minutes. Navigation had no separate operation timeout, so it inherited that deadline.
A future diagnostic may use the existing 120-second readiness allowance as its navigation cap.
That proposal does not change measurement windows, samples, budgets, retries or verdicts. No timeout change was made.
No product fix or repeat run occurred. Owned runtime cleanup is confirmed.
See the [interrupted run and complete limits](../../.lavish/product-audit/assets/after-sep12/terms-lcp/README.md).

### Performance-gate proposal remains unintegrated, 12 September

The current gate at `9cc8c5336` preserves all six retained performance breaches.
A replay uses the original printed sample arrays and counts. It is not a fresh browser measurement.
Issue 1640 concerns an unintegrated proposal that removes some over-ceiling medians from its failure list.
Source review identifies four suppressed breaches in the retained data. No proposed code was executed or integrated.
The proposed correction must retain every breach, with uncertainty reported separately.
No budget, sample, retry, product file or test changed. The issue remains open.
See the [replay and source review](../../.lavish/product-audit/assets/after-sep12/performance-median-gate/README.md).

### Landing pint target dependency hold, 12 September

Issue 1636 remains open. Served source `9cc8c5336` has no `a.lpPubPint` at 320, 390, 430 or 1440px.
The label is a non-interactive span with no destination. Normal scrolling confirms the span owns its centre point.
The proposed link belongs to the unintegrated invite/drink-brand lane ending at `4c9608b421`.
No link, CSS change, build or commit was added. This is a dependency hold, not a resolved touch-target issue.
See the [served evidence and dependency](../../.lavish/product-audit/assets/after-sep12/landing-pint-target/README.md).

### Shared venue reads, 12 September

Commit `9cc8c5336` replaces duplicate Bar Tab, Ledger and share-image readers with `lookupVenueDetail`.
Found, missing and unavailable states remain distinct. Canonical IDs still select community data and links.
Ledger uses existing curation and venue-kind metadata. Empty prices do not become community price rows.
American Bar at The Savoy, Rules and Grove Alehouse now show named pages instead of missing cards.

The audit fast-forwarded to the exact reviewed commit. Full verification passes: 17,239 unit tests and 374 database tests.
One existing unit skip remains. Lint reports zero errors and 21 warnings. The build and 75 focused tests pass.
Forty-two matched page observations, nine actual cross-page journeys and two unchanged mobile browser tests pass.
Both pages recover through Try again after real file-read failures, without restarting their process.
The failed share image uses no-store. Its actual image recovers after file restoration.

Most after-change timing samples are slower. No performance improvement or budget clearance is established.
The captures use browser emulation, light mode and explicit onboarding/consent state. Populated photo walls remain unproved.
One SiteNav text sampling difference is retained. Browser version was not captured during the run.
See the [reviewed evidence and complete limits](../../.lavish/product-audit/assets/after-sep12/venue-detail-callers/README.md).


### Fresh half-pint reproduction, 12 September

The unchanged two-case spec ran against exact source `05fdc8248`, with one worker and zero retries.
The pint submission passes. The half case fails before any submission, after its initial pin screenshot.
The target disappears from the painted-pin probe. Camera, target projection, canvas hit owner, theme and lens remain unchanged.
The failure cause remains unproven. Selection-layer and collision placement need current-source observation.
The historic debugger helper is pinned to `4a3f77e28`; it does not establish current layer state.
No product code or assertions changed for this run.

The later bounded investigation clears neither a product fix nor a fixture correction.
After Close, the selected symbol withdraws. The normal symbol remains unplaced, although the worker retains the target.
The exact placement blocker is unknown. Total source features grow from 365 to 619 during capture.
After real Expand and Collapse actions, the sample reports a placed selected icon. The modal portal intercepts its tap location.
That placement sample is stale. It proves neither settled placement nor exact colour through the modal tint.
Neither path reaches half submission, receipt verification or the final pixel comparison.
The full copied Collapse experiment remains unrun. Shared-sheet mechanics remain under their existing hold.
See the [reviewed investigation](../../.lavish/product-audit/assets/after-sep12/half-pin-investigation/README.md).
See the [fresh run](../../.lavish/product-audit/assets/after-sep12/half-05fd.json) and [log](../../.lavish/product-audit/assets/after-sep12/half-05fd.log).

### Query-bearing navigation warming, 12 September

Commit `05fdc8248` preserves query strings and removes fragments from navigation warming keys.
Each history retains at most 128 successful calls. Failed calls do not insert or evict keys.
The audit fast-forwarded to the exact reviewed and tested commit.

Full verification passes: 17,219 unit tests, one existing skip and 374 database tests.
The production build and 27 focused tests pass. Lint reports zero errors and 21 warnings.

The matched browser diagnostic covers four journeys and twelve actions on each build.
Discover now forwards its query. Nearby now makes its own exact-query helper call.
All captured action bodies reach EOF before clicks, without read errors. Deployment IDs match on both builds.
Mobile tabs and landing links retain their helper and HTTP request counts. Repeat windows remain empty.

The original Playwright request-completion probes remain failed and preserved.
Native body completion does not explain those abort events or prove cache population, page readiness or latency gains.
Member checks use stated auth/API fixtures. Public checks use actual responses.
See the [evidence and limits](../../.lavish/product-audit/assets/after-sep12/navigation-warming/README.md).


### Signed-out Social spacing, 12 September

The phone boundary reserves 220px for 68.78px of content. Desktop reserves 200px.
The first candidate, `410b5185f`, removes this reserve as soon as sign-out resolves.
Its phone arrival records two layout-shift entries, so that behavior is rejected.

Source `3af145eeb` releases the reserve only when the adjacent public card section appears.
Loading, empty, failed and other access states retain their existing space.
Public cards move 151.22px higher on phones and 131.22px higher on desktop.
The observed phone arrival has one shift entry of 0.02317, compared with the baseline entry of 0.08382.
Desktop retains its 0.00147 navigation shift entry. These observations do not establish complete page CLS or field results.

Both source reviews, 38 focused tests and the fresh build pass.
Five browser cases pass: phone, desktop, delayed cards, empty responses and failed responses.
An initial error fixture waited for a cancelled response body. The corrected fixture checks response status and rendered geometry.
The failed fixture and rejected layout evidence are preserved.
Full verification passes: 17,214 unit tests, one existing skip and 374 database tests across 32 files.
Database checks take 170.17 seconds with one cluster. Lint has zero errors and 21 warnings.
Root computer use passes signed-out Posts/Discover navigation, Back and Forward on the latest build.
The local data returns no public packs; the card-placement evidence uses explicit fixtures.
See [scope and measurements](../../.lavish/product-audit/assets/after-sep12/social-boundary-manifest.json).

### Composer loading, 12 September

The instrumented `5793f26d6` run reproduces 57 Discover requests and 1,077 KB.
Its counted inventory contains 31 scripts, 22 stylesheets, three fonts and the document.
The composer stylesheet is among those files, although Discover cannot show the composer.
See [counted resources](../../.lavish/product-audit/assets/after-sep12/discover-warm-5793.json).

Source `d0cad444c` changes the shell's Composer and Outbox imports to SSR-enabled dynamic imports.
Existing account guards, keys, callbacks and internal media imports remain unchanged.
Both source reviews are clear. All 98 focused tests pass, including account withdrawal, abort and draft isolation.
The fresh build passes. Fifteen composer browser cases and five media cases pass.
These include eight width/theme keyboard and accessibility cases. Sessions use provider-shaped test data.
The 46-route sweep finishes in 16 minutes. Discover passes at 53 requests, 995 KB and 316 ms LCP.
Plain Social passes at 50 requests and 938 KB. Both routes remove four requests and 82 KB.
The full run still fails six timing limits across Rounds, Crawls, Borough, Terms and Places.
Places fails server and paint limits. The cause remains unresolved; the failed evidence is retained.
A later host snapshot finds other build and browser work. It does not prove overlap during measurement.
Subsequent full verification passes on descendant `3af145eeb`, including this change.
See [scope and evidence](../../.lavish/product-audit/assets/after-sep12/composer-split-manifest.json).

### Current verification repair, 12 September

Source `f22824cd0` loads Starter Packs and the founding-members link only when their existing Posts branches render.
All 70 focused tests pass after one positive fixture waits for its loaded card.
Immediate account-withdrawal and read-only assertions remain unchanged. Both source reviews are clear.
Its full verification fails during PostgreSQL setup: a worker deletes another worker's unpublished slot owner.
A separate two-process reproduction produces the same `ENOENT` error.

Source `5793f26d6` replaces directory slots with exclusive loopback listeners.
The operating system releases each listener when its worker exits. Existing PostgreSQL child shutdown remains required.
All concurrent proof runners must use this protocol and the same cluster budget.
Older directory-based runners must finish before the protocol changes.
Twelve focused checks pass, including concurrent workers, killed workers, repeated release and listener errors.
Both independent source reviews are clear. Full verification passes with one cluster.
It passes 17,207 unit tests, one existing skip and 374 PostgreSQL tests. Lint has zero errors and 21 warnings.
The fresh build and eight browser cases pass on `5793f26d6`. Sessions use provider-shaped test data.
Its 46-route performance sweep fails only Discover requests: 57 against 56. JavaScript is 1,077 KB and LCP is 280 ms.
Plain Social passes at 54 requests and 1,020 KB. All other rows and metrics pass.
The sweep takes 13.9 minutes with zero retries. No ceiling changes.
See [complete measurements](../../.lavish/product-audit/assets/after-sep12/performance-5793.log).
See [repair evidence](../../.lavish/product-audit/assets/after-sep12/postgres-slot-lease-manifest.json).

### Social asset loading and plain copy, 12 September

Source `e8cabf145` changes four Posts controls to SSR-enabled dynamic imports.
It preserves their render conditions, props, account keys and markup.
All 38 focused tests pass. Two independent source reviews are clear.
The matching route-prefix diagnostic reduces Discover from 63 to 61 requests and from 1,128 KB to 1,092 KB.
Its request budget still fails at 56. Plain Social stays at 54 requests and falls from 1,059 KB to 1,029 KB.
See [the e8c manifest](../../.lavish/product-audit/assets/after-sep12/posts-chunks-e8c-manifest.json) and [counted inventory](../../.lavish/product-audit/assets/after-sep12/discover-warm-e8c.json).

Source `c98be1bf2` moves the unchanged post-card and feed renderers into `app/social/SocialFeedPosts.tsx`.
The shell loads that module only when its existing feed branch renders.
Gallery, video and the video helper stay together, so video opening gains no separate loading boundary.
The feed keeps its account and request key.
The initial focused run passes 50 tests and exposes one fixture timing failure.
The fixture now waits for Account A's rendered post before testing account changes. Immediate withdrawal assertions remain unchanged.
All 51 focused tests then pass. Both independent source reviews are clear.

Source `3442cb98d` also replaces internal API wording with a plain description of tonight's listings.
Full verification passes: 17,201 unit tests, one existing skip and 374 PostgreSQL tests across 32 files.
Database checks take 91.82 seconds with one cluster. Lint reports zero errors and 21 complexity warnings.
Type, dead-code, skip-policy, freshness and dependency checks pass. Three credential-backed feeds remain unmeasurable.
Generated data stamps are restored after verification.
The production build passes on port 3416.
Five browser cases pass for phone feeds, Following, Nearby, both themes, gallery controls, MP4 playback and video focus restoration.
These use a provider-shaped fixture session, not a real account.
Root computer use passes signed-out Posts/Discover navigation, Back and Forward, and confirms the cleaned-up paragraph.
The complete 46-row sweep finishes in 14.2 minutes with one failure.
Discover makes 58 requests against 56 in all seven samples. JavaScript is 1,082 KB and LCP is 272 ms.
Plain Social makes 51 requests and loads 1,019 KB. All other rows and metrics pass.
The run uses zero retries and changes no ceiling.
See [complete results](../../.lavish/product-audit/assets/after-sep12/performance-3442.log).
No release or full performance acceptance is claimed.
See [the current manifest](../../.lavish/product-audit/assets/after-sep12/feed-boundary-3442-manifest.json), [full verification](../../.lavish/product-audit/assets/after-sep12/verify-3442.log) and [browser results](../../.lavish/product-audit/assets/after-sep12/feed-boundary-browser.log).

### Recovery on 12 September

The audit checkout retained its source and archived evidence during the pause.
Main contains five later commits, ending at `48f4ac8c6`. Merge `16d7197c2` integrates them into this checkout.
The initial 12 September GitHub inventory contained six open pull requests and 33 open issues.
Earlier acceptance results retain their original build scope.

The reviewed Pal height repair is integrated as `d2156ab6e`, from `6fbf6a240`.
It publishes the rendered height separately from the minimum height and preserves the avatar width.
Scoped lint passes without errors or warnings. All five lifecycle tests pass. The later browser result appears below.

The merge preserves the audit's Social layout and main's guarded prefetch policy.
The first scoped run catches four unguarded Social links. After correction, all 100 tests pass across eight files.
TypeScript and conflict-file lint pass. The fresh normal production-mode build also passes.
Its [version record](../../.lavish/product-audit/assets/after-sep12/normal-version.json) identifies `16d7197c2`.
The initial browser attempt cannot launch because the pinned Chromium executable is missing. No product assertion runs.

After restoring Chromium 151.0.7922.34, city selection passes on `16d7197c2`.
The retarget test refuses stale motion entry. Its option is clickable, but both drawers have reached their endpoints.
The Pal fixture initially expires before the normal 30-second shell release and clears the consent marker during navigation.
The corrected fixture preserves fresh-context isolation and the real first-route marker. It allows the normal shell lifecycle to finish.
Both 320 and 430 widths pass geometry checks, but the maximum-length name wraps at both widths.
The final fixture adds 640 pixels and returns to 320. Its strict shrink and restoration checks remain intact.

The [Pal height run](../../.lavish/product-audit/assets/after-sep12/pal-height-pass/result.json) passes both cases in 65.837 seconds.
Each checks full text, the 36-pixel avatar, 44-pixel controls, 12-pixel gaps and centre-hit ownership.
Measured heights are 56, 56, 52 and 56 pixels at 320, 430, 640 and the return to 320.
The consent case then dismisses consent at 320 and checks the restored Create control.
Root viewed the retained 320-pixel screenshots. This does not clear credits collisions or native acceptance.

The route target check finds 15-pixel Tonight source links. Computer use confirms the same geometry at 390 pixels.
Commit `6e3985ddf` adds the shared control minimum to those links. Their text and destinations remain unchanged.
Fresh normal and keyless builds pass at `9d002ca85`. Tonight and Today pass the route target check.
The keyless composer also passes. The route sweep then finds a 43-pixel Round button on `/crawls`.
Commit `3cefc4e3e` gives both Round button variants the shared control minimum.

The first full gate finds one stale Analytics anchor assertion. The anchor's added ref does not remove its ID or controls.
Commit `e631ecb0f` preserves the div and ID check while accepting additional attributes. All 21 focused tests pass.
The [full verification rerun](../../.lavish/product-audit/assets/after-sep12/verify-pass.log) then passes at `e631ecb0f`.
It records 17,184 passing unit tests, one existing skip, and 374 passing PostgreSQL tests across 32 files.
Lint has zero errors and 21 complexity warnings. TypeScript, dead-code, skip-policy, freshness and dependency checks pass.
The dependency check reports no high or critical vulnerabilities. Three credential-backed feeds remain unmeasurable.
Generated data stamps were restored after the gate. A fresh normal build passes at the same commit.
The [unchanged mobile target sweep](../../.lavish/product-audit/assets/after-sep12/targets-pass/result.json) passes all ten routes in 11.3 seconds.
Today, Tonight and Round controls meet the existing 44-pixel minimum. No skip or retry runs.

The [Places baseline](../../.lavish/product-audit/assets/after-sep12/places-baseline/result.json) passes two cases and fails Chester in 23.342 seconds.
Chester remains in the field, but only Manchester appears. The page makes no town-index request and renders no Chester row.
Northern quarter opens Manchester's city page without a town-index request during the measured query phase.
Didsbury reads the real town index and opens `/map/manchester`.
The exact temporary spec, request records, screenshots and traces are retained. The coordinator owns the Chester correction.

Commit `ffae22c2c` corrects city-name matching and preserves tagline search. All 91 focused tests, scoped lint and TypeScript pass.
The fresh production-mode build passes. The [unchanged Places cases and town fallback tests](../../.lavish/product-audit/assets/after-sep12/places-after/result.json) pass five cases in 3.928 seconds.
Chester reads the real town index and opens its own map location. Both control searches keep their prior behavior.
The licence credit also passes its existing geometry check. No case is skipped or retried.
The [full gate](../../.lavish/product-audit/assets/after-sep12/places-after/verify.log) passes at this candidate.
It records 17,187 passing unit tests, one existing skip and 374 passing PostgreSQL tests.
Lint reports zero errors and 21 complexity warnings. Three credential-backed feeds remain unmeasurable.
Generated data stamps were restored. Native acceptance remains open.

The standalone Chester fix is published in [PR #1651](https://github.com/Singularityszn/pubmax/pull/1651), at `eaa657540`.
Its own full gate passes 16,448 unit tests and 372 PostgreSQL tests, with one existing unit skip.
Its separate build and all five browser cases pass. These counts belong to the standalone source, not the audit branch.

### Android follow-up on 12 September

The [native baseline](../../.lavish/product-audit/assets/after-sep12/android-baseline/manifest.json) uses the actual Android shell at `ffae22c2c`.
It runs on an isolated API 36 emulator with WebView 133, at 390 by 773 CSS pixels and DPR 3.
First launch opens onboarding. Pal selection, Back and the Plan handoff respond to device taps. Second launch opens Tonight.
Now and You work in both themes. Tonight source links measure 44 pixels. Plan explains its disabled lock with “Add your name.”
These checks do not establish physical-device, account, push or store acceptance.

Two native failures remain visible in the baseline evidence. An explicit dark app theme leaves white status icons on a pale background.
A main-document HTTP 503 opens the bundled error page, but Retry returns to the homepage and loses the selected venue.
One earlier recovery attempt was interrupted by the runner. Only the completed recovery observation establishes the failure.

Commit `640193225` retains the failed document through its HTTP commit and preserves its safe query and fragment.
The [native recovery recheck](../../.lavish/product-audit/assets/after-sep12/android-950f/runtime/recovery-observations.json) passes at `950f2e8a2`.
The actual Retry tap restores The Queen’s Head at its exact URL. The corrected load-failure copy has a 48-pixel Retry action.
All 16 Java unit tests pass. Focused JavaScript checks pass, including five tests for following the system theme.

The first window-theme repair fails its native recheck: Capacitor resets the background after the app applies its color.
Commit `05df9e62a` applies the app color after the system-bar calls and after configuration callbacks.
Source review and 12 focused tests pass. The fresh web and Android builds pass.
The [native theme recheck](../../.lavish/product-audit/assets/after-sep12/android-05df/manifest.json) passes all six app and OS theme cases.
The hardware-backed emulator preserves the full Tonight heading in all six screen captures.
The software renderer shows a blank band after OS theme changes, including with the earlier native APK.
WebView captures preserve the heading. Hardware rendering removes the band without a product change.
A diagnostic background-setter change did not help and was reverted. This evidence does not establish physical-device behavior.
The [complete repository gate](../../.lavish/product-audit/assets/after-sep12/android-05df/verify.log) passes at `05df9e62a`.
It records 17,190 passing unit tests, one existing skip and 374 passing PostgreSQL tests.
Lint has zero errors and 21 complexity warnings. Type, unused-code, skip-policy, freshness and dependency checks pass.
Three credential-backed feeds remain unmeasurable. No high or critical dependency vulnerabilities were reported.
Generated data stamps were restored. Both native repairs remain local and unpublished.

### iOS follow-up on 12 September

The [fresh iOS evidence](../../.lavish/product-audit/assets/after-sep12/ios-05df/manifest.json) uses source `05df9e62a` and the matching local web build.
The signed simulator build passes on iPhone 17 Pro with iOS 26.5, at 402 by 874 CSS pixels.
A fresh install opens onboarding. The second cold launch opens Tonight. Both expose the native bridge and shell marker.
System dark mode changes the app theme correctly. Native screenshots preserve the complete heading and readable status icons.
The onboarding Use London button measures 155 by 50 pixels. It is enabled and passes the centre hit check.

Actual app taps remain blocked by the test tools. Desktop control reports `noWindowsAvailable`.
Native accessibility snapshots omit web controls in both the app and Safari. Safari toolbar controls accept semantic taps.
These observations do not establish an app-specific accessibility defect. They also do not prove onboarding completion or wider navigation.
An early landing screenshot captured startup in progress. Settled evidence disproves the earlier persistent entry-failure interpretation.
A launch command with relative log paths failed. Absolute log paths succeeded; this was a setup failure.

The owned simulator was deleted and its control daemon stopped. The generated package manifest was restored.
No iOS source change was needed. Physical-device, account, push and store acceptance remain open.

### Chester publication status

PR #1651 remains open and unmerged. Its remote performance check failed after the local browser and full-gate passes.
The [failed job log](../../.lavish/product-audit/assets/after-sep12/chester-ci-performance.log) reports one breach: `/places` LCP is 312 ms against 300 ms.
The 4% breach has no waiver or rerun. Run `34689454061`, job `103542038103`, retains the original measurement.

### Pint Index follow-up on 12 September

The separate candidate `496e076a0` passes all six actual-route checks and 118 focused tests.
The [baseline](../../.lavish/product-audit/assets/after-sep12/pint-index-baseline/manifest.json) incorrectly pools qualifying counts across months.
It also treats missing and invalid snapshots as empty data.
The [candidate evidence](../../.lavish/product-audit/assets/after-sep12/pint-index-after-496e/manifest.json) confirms empty and split-month snapshots remain unindexed.
A qualifying month enables indexing and the sitemap entry. Missing or invalid snapshots return HTTP 500 for both routes.
Restoring valid data restores the page and sitemap without a restart.
These browser checks use actual development routes with temporary local fixtures. They do not prove production sitemap generation.
The [invalid-data production build](../../.lavish/product-audit/assets/after-sep12/pint-index-invalid-build-result.json) exits 1 during sitemap generation.
It reports `Public Pint Index snapshot is unavailable`. The original snapshot was restored with its exact hash.
The [full candidate gate](../../.lavish/product-audit/assets/after-sep12/pint-index-verify.log) passes: 16,452 unit tests and 372 PostgreSQL tests.
One existing skip, 68 lint warnings and three unmeasurable feeds remain. The valid production build passes.
The [production browser check](../../.lavish/product-audit/assets/after-sep12/pint-index-production-496e/manifest.json) confirms the exact candidate build.
The held page returns 200 with noindex. Its sitemap returns 200, omits the hub and retains the June edition.
Build time is `2026-09-12T11:32:31.809Z`. The separate candidate is ready for PR review, not release approval.
The candidate is published in [PR #1645](https://github.com/Singularityszn/pubmax/pull/1645) through a normal fast-forward.
It remains open and unmerged, with corrected-head CI pending. No waiver or deployment occurred.
This candidate is separate from audit source `05df9e62a`. No integration or release acceptance is claimed.

### Area prefetch repair on 12 September

Candidate `36d737a17` includes the one-line product repair `c9b07e506`. Area cards no longer prefetch destinations on sight.
The [candidate evidence](../../.lavish/product-audit/assets/after-sep12/social-prefetch-36d-manifest.json) records a passing production build, 51 focused tests and two clear source reviews.
The baseline browser records three prefetch requests. The candidate records none and the Shoreditch link still opens the map.
The first navigation check matched duplicate links in the summary and details lists. A scoped summary-list locator passes.

Fresh-context Discover inventory falls from 73 requests to 71. Its 1,388 KB JavaScript count is unchanged.
Plain Social remains at 59 requests and 1,314 KB. These fresh-context figures do not replace the warmed sweep below.
The budget now measures legacy redirects separately and preserves the complete `/social?tab=discover` destination budget.
Its limits remain 1,130 KB, 56 requests and 1,000 ms LCP. Redirect destination checks include the query and origin.
Full verification at `36d737a17` failed its fixed 45-row inventory assertion. It recorded 17,198 passes, one failure and one skip.
The PostgreSQL stage did not run. Commit `53b8c3370` corrects the count to 46 without changing limits.
Complete performance acceptance remains open. No source was pushed or deployed.

### Server-side editorial cards

Candidate `85f101bce` builds fixed editorial and heritage cards on the server. Client components receive resolved card fields.
It also replaces three catalogue imports with the existing map-link leaf. Card text, order, destinations and fallback labels stay unchanged.
Plain Social and the disabled-feature path do not call the builders. The compatibility page uses the same server builders.
All 63 focused tests pass. Two independent source reviews are clear. The production build passes.
The unchanged [London and Manchester browser comparisons](../../.lavish/product-audit/assets/after-sep12/editorial-parity-after.log) both pass.
They compare every rendered editorial and heritage card against the actual `05df9e62a` baseline.
The [fresh-context resource comparison](../../.lavish/product-audit/assets/after-sep12/editorial-85f-manifest.json) reduces Discover JavaScript from 1,388 KB to 1,384 KB.
Its 71 requests are unchanged. Plain Social remains at 1,314 KB and 59 requests.
The [full gate](../../.lavish/product-audit/assets/after-sep12/verify-85f.log) passes: 17,201 unit tests and 374 PostgreSQL tests.
One existing skip, 21 lint warnings and three unmeasurable store feeds remain. Generated data stamps were restored.
The corrected 46-row standard sweep finished in 13.7 minutes with one failure.
Discover makes 63 requests against 56 in all seven samples.
Its JavaScript passes at 1,128 KB against 1,130 KB. LCP is 280 ms; server time is 16 ms.
All other metrics and rows pass. No ceiling changed. This does not replace Chester CI evidence.
See [the complete run](../../.lavish/product-audit/assets/after-sep12/performance-85f.log) and [method](../../.lavish/product-audit/assets/after-sep12/performance-85f-manifest.json).
No complete performance or release acceptance is claimed.

A separate diagnostic repeats the standard route prefix through Discover.
It reproduces 63 requests and 1,128 KB in all seven target samples.
All 62 counted resources are static assets, plus the document request.
No API or navigation prefetch starts before the 448.2 ms boundary in the retained final inventory.
Delaying those API calls cannot fix this measured request breach.
See [the counted inventory](../../.lavish/product-audit/assets/after-sep12/discover-warm-85f.json).
This diagnostic does not replace the full sweep.


### Performance sweep on 12 September

The [45-route sweep](../../.lavish/product-audit/assets/after-sep12/performance-05df-manifest.json) finishes in 14.5 minutes on production build `05df9e62a`.
It uses the tracked 390 by 844 viewport, DPR 1, four-times CPU slowdown and Fast 4G method.
One worker runs with zero retries. All route rows produce measurements.
The sweep fails four limits: Discover and Drinks each load 1,132 KB of JavaScript against 1,130 KB.
Each also makes 63 requests against 56. All seven samples retain these byte and request counts for both rows.
All measured LCP and server-render medians pass. These results do not replace Chester's separate CI failure.

Both failing paths redirect to `/social?tab=discover`. Plain `/social` measures 1,059 KB and 54 requests.
Resource inventory is underway. Redirect accounting must preserve the query target's complete budget coverage.
No ceiling was raised, no failure waived and no repeat sweep started.

## Earlier audit evidence

The following results retain their source snapshots. Later results above replace corresponding earlier pending checks.

The final half-pin layer diagnostic failed the original after-screenshot pin assertion on 8 September.
Its temporary JSON and trace disappeared before archival. Layer observations are unavailable and cannot establish the cause.
The earlier archived half-pin failure remains available below.

The Today location-policy link now has its own 44-pixel minimum target in `920290d68`.
The fix changes five CSS declarations. Its text, destination and handlers remain unchanged. Fresh built-browser proof is still required.

Publisher category policies are explicit ordered tables in `4f433ed47`. Each publisher retains its own rules and precedence.
Their 59 focused tests pass. Scoped lint reports zero errors and warnings.
The first TypeScript check finds a missing module declaration. The retained follow-up adds exact input and output types.
Full TypeScript then passes at `99d36da30`. No publisher request or generated-data change ran.

The [Pal sizing experiment](../../.lavish/product-audit/assets/pal-sizing-4a3/summary.json) completes 16 valid samples without errors.
Every sample retains the complete stored name, accessible name and text fragments.
Normal source cases with 32-character names require 56 pixels. The current reservation assumes 52 pixels.
The unchanged 32-W case also compresses its avatar to 20.55 pixels. Root viewed that screenshot.
Synthetic doubled text produces larger heights. It is not native text scaling or a browser-zoom test.
A narrow repair will publish actual Pal height through existing elements. It will add no host or credits interaction.

The [Performance observation](../../.lavish/product-audit/assets/after-4a3/retarget-performance-4a3-bcc-decoded/drawer-exchange-performance-status.json) completes with no capture errors.
The strict retarget test still fails. Long renderer Commit spans overlap GPU tasks under the software WebGL backend.
Those spans contain little recorded renderer CPU time. They do not justify an app JavaScript rewrite.
The exact graphics wait remains unidentified. The fixture's moving-phase setup also remains unreliable across the observed browser runs.

## Current browser checks at 4a3f77e28

Both fresh builds pass, including TypeScript. Normal and keyless version records match the exact source.
Scoped lint has zero errors and one existing complexity warning. That same warning appears in the previous full gate.

The retarget test reaches the correct second trusted selection in Chromium and Firefox. The suggestion is visible in both.
Both still fail the strict inbound-position assertion. Chromium records x=800; Firefox records x=798.950012 during overshoot.
Their [Chromium trace and log](../../.lavish/product-audit/assets/after-4a3/retarget-4a3-chromium.log) and [Firefox result](../../.lavish/product-audit/assets/after-4a3/retarget-4a3-firefox.json) remain unchanged.
Trace review finds serialized snapshot waits between commands. It does not attribute all elapsed time to snapshot collection.
A bounded comparison without tracing will keep the same source, actions, motion and assertions.
A passing comparison would identify observation sensitivity. It would not erase these failures or prove their complete cause.

The [half and pint run](../../.lavish/product-audit/assets/after-4a3/half-4a3.json) passes one case and fails one.
The half journey now keeps its camera at zoom 14 with the same center and target projection.
No new area command occurs. This supports the camera correction in the observed interval.
The target still leaves the painted-point list before the screenshot check completes. That separate failure remains under investigation.
Root viewed the retained viewport. The half journey sends no submission. The pint journey passes.

The [complete profile and caption run](../../.lavish/product-audit/assets/after-4a3/profile-caption-4a3.json) passes all 38 cases in 117.767 seconds.
The delayed account-controls regression, normal profile menu and full desktop consent capture pass.
Both story caption cases pass with all expanded measurements from the same frame. Root viewed the 390-pixel expanded story.
Root also viewed the 768-pixel Filters capture. These images do not clear the separate combined Pal and consent matrix.

The controlled comparison without tracing still fails both retarget cases.
Chromium reaches x=800 after overshoot, before its later recorded settlement marker. Firefox clicks at x=1440 before inbound movement starts.
Tracing alone does not explain these failures. Main-thread timing remains under investigation; no threshold or motion change was made.

The [remaining GPU-backed group](../../.lavish/product-audit/assets/after-4a3/remaining-gl-4a3.json) passes 28 cases and fails three in 171.644 seconds.
All tile and WebGL recovery cases pass. The missing compass remains under the Reset hold.
UK pin switching still meets the existing modal boundary. This does not prove a new routing defect.
The Today location-policy link measures 38.6 pixels high, below the unchanged 44-pixel requirement. A narrow correction is underway.
The [keyless composer](../../.lavish/product-audit/assets/after-4a3/keyless-4a3.json) passes refused-draft retention and the unpriced save.
All these runs use zero skips and retries. Complete browser and native acceptance remain open.

## Current browser checks at 6dfada19a

Both production-mode builds pass, including TypeScript. Their version records match the current source.
The [eight-file regression](../../.lavish/product-audit/assets/after-6df/regression.json) passes 96 cases and fails seven in 175.992 seconds.
The run uses one worker, with zero skips or retries.

The Moment editor passes the complete interaction test, including the pending identity prompt after closing.
The test dismisses that real prompt, reopens the editor, and verifies crop, filter, text, drawing and changed pixels.
Root viewed the [completed editor](../../.lavish/product-audit/assets/after-6df/moment-editor-390.png). Its controls remain contained and usable.
The editor phase sends no external requests or writes. The separate identity-prompt interval has its own network record.
Android install-card controls, Brewmaster search, fare-zone styling and the complete ordinary consent file also pass.

The seven failures remain explicit. Planner Close leaves the parent Layers portal open after the planner disappears.
Two Last train controls remain obstructed. The shared sheet retains its existing approval hold.
Two caption cases compare measurements from different frames. They do not prove a same-frame four-pixel collision.
The fixture now measures all relevant bounds together. It is integrated at `4a3f77e28` and has not run yet.
The profile Analytics choices target can appear after its menu click. A reviewed mount-aware fix awaits execution.
The desktop consent fixture reaches a real city suggestion first. Its reviewed correction dismisses that prompt through its button.

The unchanged [light phone matrix](../../.lavish/product-audit/assets/story-matrix-6df/report-light-reduced.json) passes four cases and fails 12.
The [dark matrix](../../.lavish/product-audit/assets/story-matrix-6df/report-dark-normal.json) fails four cases.
Those runs take 376.683 and 144.221 seconds, with zero skips or retries.
All four story-only widths pass. At 320 pixels, the actual story height is 169 pixels.
All Pal states still obstruct the collapsed attribution toggle. Expanded attribution still overlaps story controls when consent is present.

Actual expansion can scroll the document by 49 pixels. Shared spacing tokens remain unchanged during that movement.
This observation is document scrolling, not a token-driven layout change. No test scrolls back to hide it.
An offscreen wrapping experiment has an invalid second-width sample. Its requested width differs from its measured width.
The [original result](../../.lavish/product-audit/assets/story-matrix-6df/wrapping/pubmaxx-attribution-wrap-6df.json) remains preserved and untrusted for that comparison.
Source review identifies an inherited transition on the clone. The corrected diagnostic disables transitions on its temporary copies.
Actual and computed widths now match 240 and 288 pixels. Both text heights are 60 pixels.
The [corrected record](../../.lavish/product-audit/assets/story-matrix-6df/wrapping/pubmaxx-attribution-wrap-width-proof-6df.json) records no active animations and complete temporary-node cleanup.
The experiment does not prove product geometry, control access, native behavior or impossible packing.

The separate camera diagnostic records an area command after a selected pub closes. Zoom changes from 14 to 12.
A reviewed fix retains opening-location eligibility for the lifetime of that map. Its corrected baseline fails three cases.
The [same caller tests](../../.lavish/product-audit/assets/camera-opening/green.log) then pass all seven cases. Existing controls pass 110 tests.
The actual map history owner removes the selection parameter. Crawl URL synchronization preserves that parameter.
The initial harness omitted that history owner. Its separate failure log provides no product evidence.
The fix is integrated at `1b6f62d2d`, with the corrected harness at `caa6a070f`. Fresh built-browser proof remains required.
Strict desktop retargeting also records a transparent suggestion ancestor in both browsers. A reviewed CSS correction awaits built-browser proof.
The independent Chromium timing assertion remains unresolved. Its original bound will remain unchanged.

## Phone layout retest at dfe289425

Both fresh production-mode builds pass, including TypeScript. Their version records match the integrated source.
The unchanged 20-case matrix passes three cases and fails 17, with zero skips or retries.
The [light run](../../.lavish/product-audit/assets/story-matrix-dfe/report-light-reduced.json) passes story-only cases at 360, 390 and 430 pixels.
The [dark run](../../.lavish/product-audit/assets/story-matrix-dfe/report-dark-normal.json) fails all four combined cases.
The runs take 405.864 and 144.529 seconds. All original text, geometry, motion and interaction assertions remain unchanged.

Near me now keeps the required 12-pixel gap in the measured combined state.
After real consent dismissal, Create retains its position and owns its center in both motion settings.
Root viewed the 320-pixel combined screenshot. Its story still covers the top controls.
The 320-pixel story-only case fails only the 185-pixel height against the existing 30% limit.
Every Pal case retains an attribution collision. Consent-only cases cannot click attribution because Walk covers its toggle.
A more specific legacy consent rule still places attribution above its intended space. Further layout corrections remain necessary.
The next reviewed candidate shares the Pal and Near me row and corrects attribution reservation precedence.
It also reduces story vertical spacing without changing type, copy or 44-pixel controls.
Those changes are integrated at `6dfada19a`. The newer browser results appear above.

The [exact original-case accounting](../../.lavish/product-audit/assets/story-matrix-dfe/pubmaxx-crosswalk-9c441-partial-reconciliation.json) reports 51 passes, 12 failures and 14 unrun cases at 9c441.
That record preserves all 77 original cases and 81 mapped targets. Independent source review confirms its arithmetic and identities.
It gives no credit to similar test names, other browser projects, older runs or this separate story matrix.

The Moment editor failure shows two competing modal dialogs. A reviewed fix now defers the identity prompt during editing.
Its pending trigger remains eligible after closing. All 33 focused tests pass.
Scoped lint and full TypeScript checks also pass. The later 6df browser run proves the real modal handoff.
Reviewed fixture corrections preserve actual selection, navigation, touch, modal and reset checks. They do not clear product behavior by source review.

## Fresh browser checks at 9c441a733

Both production-mode builds pass and serve the exact verified source.
The [actual HTTP checks](../../.lavish/product-audit/assets/after-9c44/pubmaxx-audit-request-guards-after-9c44.json) confirm both malformed-body guards return 400.
An empty price-submission object still reaches the signed-out identity gate. It returns 401 as designed.

All four [Retry journeys](../../.lavish/product-audit/assets/after-9c44/pubmaxx-audit-request-ui-notices.log) pass, including the complete 1440-pixel dark recovery.
Fifteen captured normal, hover and focus states include the responsive phone transition.
Minimum measured text contrast is 6.442. Minimum focus contrast is 4.636. Original thresholds remain unchanged.
Root viewed the dark phone control and recovered desktop screenshots.

The same run passes the four landing citation targets. Each target is 44 pixels high, unobstructed and separate.
Root viewed the [landing card](../../.lavish/product-audit/assets/after-9c44/landing-attribution-card.png). Its collected year wraps alone and remains a visual polish item.
The run totals five passes, zero failures, skips or retries, in 53.364 seconds.
All [28 core UI cases](../../.lavish/product-audit/assets/after-9c44/pubmaxx-audit-request-ui-core.log) also pass again at this build.
The separate phone story, Pal and consent matrix fails all 20 cases. Broader browser and native acceptance remain open.

## Remaining browser results at 9c441a733

The [remaining Chromium run](../../.lavish/product-audit/assets/after-9c44/pubmaxx-audit-request-ui-crosswalk-rest.json) passes 152 cases and fails nine.
It covers 26 complete files in 365.621 seconds, with zero skips or retries.
Failures include fare-zone borders, planner navigation, Arnos Arms search, a concurrent modal, venue-tab obstruction, photo editing and consent geometry.
The 768-pixel shared map-boundary assertion also fails. Source triage is underway.

The [retarget and price run](../../.lavish/product-audit/assets/after-9c44/pubmaxx-audit-request-ui-retarget-price.json) passes 50 cases and fails four.
The [Firefox run](../../.lavish/product-audit/assets/after-9c44/pubmaxx-audit-request-ui-firefox.json) passes 16 cases and fails strict retargeting.
Both browsers report a center-owned suggestion whose ancestor-aware visibility check fails. No second click occurs.
Firefox records the failure during drawer motion. Chromium records it after the drawer reaches its settled position.
The half-pin capture records a camera change from zoom14 to12. The intended pin leaves the measured crop before submission.
Two price-caption cases record a four-pixel overlap with expanded attribution. These failures remain open.

Five reviewed commits are integrated through `dfe289425`. Scoped fixture lint and whitespace checks pass.
Shared mobile spacing now uses one reservation. Expanded attribution reserves its complete toggle width and a gutter.
Story-mode Create stays in position while fading. New diagnostics retain retarget ancestors and the original pin projection.
The diagnostics add no waits, clicks or weaker assertions. Fresh builds and unchanged acceptance checks are next.

## Phone story and attribution failures at 9c441a733

The [light matrix](../../.lavish/product-audit/assets/story-matrix-9c44/report-light-reduced.json) fails all 16 cases in 379.686 seconds.
The [dark matrix](../../.lavish/product-audit/assets/story-matrix-9c44/report-dark-normal.json) fails all four combined cases in 144.668 seconds.
Neither run skips or retries a case. Their identities include the served build, browser version, and exact fixture hashes.

At 320 pixels, the story is 185 pixels tall. It exceeds the existing 30% viewport-height limit.
Consent can move its top to -25 pixels. Pal can cover attribution, and TfL can block story controls.
Combined Pal and consent leave four pixels above Near me, below the required 12 pixels.
After consent dismissal, Create can cross Near me and receive its center hit.
Reviewed shared spacing corrections are integrated at `dfe289425`. Fresh build and browser proof remain pending.
The separate story-height requirement remains open.

Computer-use inspection confirms an attribution link obstruction at 360 pixels.
The final two letters of OpenMapTiles intersect the toggle and send their center hits to that control.
The [text and hit record](../../.lavish/product-audit/assets/story-matrix-9c44/glyph/pubmaxx-attribution-glyph-iab-360.json) retains the expected link and actual hit owner.
At 390 pixels, two unlinked character rectangles intersect the toggle. The 320- and 430-pixel samples have no character intersections.
These are text-layout rectangles, not painted glyph masks. Document scrolling makes their absolute map positions unsuitable for matrix comparisons.
No external attribution link was opened. The temporary in-app tab was closed and its viewport override reset.
The tested 44-pixel toggle has only 28 pixels of reserved padding. Its reviewed correction now awaits fresh browser proof.

## Fresh browser checks at 8db35df35

The [28-case UI run](../../.lavish/product-audit/assets/ui-8db.log) passes every case, with zero skips or retries.
Recipient light text measures 5.2744 normally and 4.7384 on hover. Dark text measures 6.4832 and 5.8921.
The unchanged text requirement is 4.5. Keyboard focus remains visible and exceeds its required contrast.

The [seven map cases](../../.lavish/product-audit/assets/map-8db.log) produce six passes and one failure.
All three original post-paint outage cases pass. Three notice cases pass the complete journey.
The 1440-pixel dark case passes containment, both drawers, dismissal, and the responsive phone transition.
It then rejects a tile request that started 187.8 milliseconds before the actual new construction.
A reviewed fixture correction will match requests to that construction. The complete dark recovery check remains open.

Image review identifies a separate dark Retry defect. Its text and button use the dark background token as their foreground.
The [phone image](../../.lavish/product-audit/assets/map-8db/1440-dark-notice-stack-phone-inline-390.png) and desktop image show nearly black text on black.
Minimal color corrections are integrated. Actual contrast checks await the next build. Geometry passes do not clear this defect.

The [complete Chromium group](../../.lavish/product-audit/assets/crosswalk-8db/pubmaxx-crosswalk-fresh-chromium.log) passes 176 cases and fails 32 across 29 files.
It has no skips or retries. The run takes 882.186 seconds.
The [GPU-backed group](../../.lavish/product-audit/assets/crosswalk-8db/pubmaxx-crosswalk-fresh-chromium-gl.log) passes 25 cases and fails five.
The [keyless composer case](../../.lavish/product-audit/assets/crosswalk-8db/pubmaxx-crosswalk-fresh-chromium-keyless.log) fails while parsing the captured request body.
The [Firefox group](../../.lavish/product-audit/assets/crosswalk-8db/pubmaxx-crosswalk-fresh-firefox-desktop-map-chrome-fit.log) passes 16 cases and fails the strict drawer retarget case.
All four complete groups total 217 passes and 39 failures, with zero skips or retries.
The [complete reconciliation](../../.lavish/product-audit/assets/crosswalk-8db/pubmaxx-crosswalk-8db-complete-reconciliation.json) maps the original 77 cases to 40 passes and 37 failures.
Five Firefox targets have file-hash changes from added diagnostics. Their original recorded assertions remain present.
The earlier Chromium-only supplement and original crosswalk remain unchanged.

The [Retry contrast baseline](../../.lavish/product-audit/assets/crosswalk-8db/pubmaxx-audit-notice-contrast-before.log) captures all 12 states before four cases fail.
Dark text measures 1.024 to 1.137 over the bounded backgrounds. The required ratio remains 4.5.
The light focus ring measures 2.415 to 2.767, below its required ratio of three.
Actual Tab navigation reaches Retry in each case. Reviewed color corrections await the next build.
Broader browser and native acceptance remain open.

The next candidate, `e5497366c`, includes the Retry colors, landing citation tap targets, and reviewed fixture corrections.
Scoped lint and full TypeScript checks pass. That scoped lint run introduced one complexity warning. The later extraction removes it.
Fresh first-open tab, attribution, and half-pin diagnostics run against the retained `8db35df35` application.

## Additional diagnostics on the retained 8db build

The [obstruction run](../../.lavish/product-audit/assets/diagnostics-8db/pubmaxx-audit-obstruction-diagnostics-8db.log) records three passes and five failures across eight cases.
On 320px, Last train sits below the screen and its scroll container. On 390px, the sticky action receives its center hit.
Both captures show zero scrolling and no active animations. The 430px, desktop, and Arnos 390px touch cases pass.
The contentful venue header places its photograph before the tab rail. The shared sheet retains its approval hold.

Attribution is also blocked. The Place story dismissal receives its center hit at 390px; Near me receives it at 430px.
The original click still fails. A scoped layout correction is integrated from these measurements. Fresh browser proof is pending.
Independent source review also identifies a possible inherited Pal-plus-consent spacing mismatch. Its actual reachability remains unproved.
The half-pin crop still fails before submission. Full viewport and settled-camera diagnostics are retained; its cause remains open.

The [complete gesture file](../../.lavish/product-audit/assets/diagnostics-8db/pubmaxx-audit-gesture-arrival-8db.log) passes two cases and fails one.
Actual arrival reads bearing -8, pitch 38, zoom 12, and no motion in all three cases.
Rotation, stillness, tilt, and pin anchoring pass. The compass control is absent, so its reset behavior remains unproved.
The earlier broad-run arrival timeout remains an unresolved intermittent failure. These passes do not erase it.

The corrected keyless composer case passes against `8db35df35`, including actual serialized bill bytes and refusal-draft retention.
Its unpriced note also saves. The corrected Near readiness case passes through the real Soho click and result header.
Each case runs once with no retries. [Full verification 9](../../.lavish/product-audit/assets/gate-attempt-9.log) fails four multipart unit-harness cases; 17,049 unit tests pass.
The stub omits the browser Request constructor. PostgreSQL is not reached. The actual keyless browser case remains a separate pass.
Lint reported one new complexity warning. A reviewed consent-assertion extraction removes it.
The [scoped lint check](../../.lavish/product-audit/assets/pubmaxx-audit-post-extraction-lint.log) passes with zero warnings. The other 23 warnings remain open.

## New request and concurrency findings

An actual local POST with JSON null returns HTTP 500 from Plan completion before its store lookup.
The [retained response](../../.lavish/product-audit/assets/plan-completion-null-before-8db.json) identifies the request and served-build scope. A narrow input guard is integrated. All 13 focused Plan completion tests pass; a fresh HTTP check remains pending.
Source review also finds that a new completion can reverse an abandoned Plan. Existing completion replay must remain valid.
Its repair needs a new migration and real database concurrency proof. Production migration application remains separate.

Venue-photo review finds a concurrent upload-cap race, uncertain publication cleanup, and a signing exception outside the advisory scan fallback.
Price-submission review identifies a possible compensation race against a later correction. These remain source findings until targeted reproduction.
No source-only review closes their acceptance requirements.

The multipart unit harness now models the browser Request constructor. All five [focused tests](../../.lavish/product-audit/assets/price-bill-native-request-unit.log) pass.
They retain corruption, missing-file and mismatched-submission refusals, and verify immediate FormData mutations cannot change the sent bytes.
Full verification must run again before release clearance.

UK observation validates the V8 callsite and records 122 rendered UK points. It stops before clicking because the camera is moving.
The [first record](../../.lavish/product-audit/assets/uk-base-8db/before-A.json) preserves actual candidates and hit winners. Selection and price submission remain unproved.
The second UK capture waits for the loading cover to leave and the actual camera to stop.
A real click selects The Star and retains its 9.90 draft. Of 20 rendered candidates, 18 are inside the viewport.
Eight hit the bare portal; ten hit sheet descendants. Two are outside the viewport.
The HALF sheet is modal by design. These hits do not establish a map routing defect.
The [after-selection record](../../.lavish/product-audit/assets/uk-base-8db/after-A-settled.json) captures this obstruction with no uninspected points.
Second selection, price submission, and restore remain unproved. Backdrop and peek behavior still need actual interaction checks.

## Request corrections before the next build

An actual price-submission POST with JSON null also returns HTTP 500 at the retained build.
The [response record](../../.lavish/product-audit/assets/price-submit-null-before-8db.json) preserves that baseline.
The corrected parser refuses non-object JSON through the existing 400 response. Multipart handling remains unchanged.
The [focused run](../../.lavish/product-audit/assets/price-submit-body-green.log) passes all 94 tests after 14 baseline failures.
Fresh built-server HTTP checks remain required for both input guards.

The venue-photo signing correction preserves the shared advisory scan policy when storage signing rejects.
The [actual-handler tests](../../.lavish/product-audit/assets/venue-photo-signing-green.log) pass all 23 cases after two baseline failures.
Staging and promotion failures still refuse publication. An explicit negative scan verdict still refuses the image.
The separate upload-cap and publication-compensation races remain open.

The first tenth gate attempt stops at lint on two archived diagnostic source files.
Their bytes remain unchanged, with text file extensions and updated provenance. No lint rule was disabled.
A new unused mock parameter is also removed through an explicit mock call type.
The [complete tenth gate](../../.lavish/product-audit/assets/gate-attempt-10.log) passes at `9c441a733`.
All 17,080 unit tests and 374 PostgreSQL tests pass. One existing unit test remains skipped.
Lint has zero errors and 23 complexity warnings. Three feeds remain unmeasurable without credentials.
The dependency audit finds no high or critical vulnerabilities. Fresh builds and browser checks are next.

## Current corrections under browser acceptance

Candidate `8db35df35` includes three reproduced fixes. Full verification and both builds pass.
The [eighth full gate](../../.lavish/product-audit/assets/gate-attempt-8.log) passes 17,053 unit tests and 374 PostgreSQL tests.
One unit test remains skipped. Lint reports zero errors and 23 complexity warnings.
Both [production-mode builds](../../.lavish/product-audit/assets/build-8db.log) pass at this exact source. Focused browser acceptance is running.
Map replacement now retains whether this map has ever loaded a style.
A failed replacement keeps the existing map and Retry when the original style had loaded.
Desktop Retry stops layout transitions when its containing block changes.
The retained cascade showed a transition from the old drawer width, which collapsed Retry to 28 pixels.
Recipient Message text and keyboard focus use the existing accessible accent token.

The [settled contrast baseline](../../.lavish/product-audit/assets/diagnostics-0f98/pubmaxx-audit-recipient-contrast-settled-before.log) runs against unchanged build `0f98a6740`.
Both dark cases pass. Both light cases fail at 390 and 1440 pixels, with no skips or retries.
Light text contrast is 2.748 normally and 2.468 on hover. The required ratio remains 4.5.
Dark text contrast is 6.483 normally and 5.892 on hover.
Keyboard focus settles at 2 pixels wide, with a 2-pixel offset. Only the light focus color fails.

The strict drawer retarget remains unproved. Its eleventh search result is outside the usable suggestion area during recorded movement.
The corrected observation first finds its center clickable after settlement. This run does not show a product animation defect.
No animation timing or strict movement assertion has changed.

## Latest complete gate at 0f98a6740

[Verification attempt seven](../../.lavish/product-audit/assets/gate-attempt-7.log) exits zero.
All 17,048 unit tests pass, with one skipped test. All 374 real PostgreSQL tests pass.
Lint reports zero errors and 23 complexity warnings. Type, dead-code, skip, freshness and dependency checks pass.
The prior attempt stopped at two greeting-placement lint errors. Both errors are corrected without suppressions.
The gate includes map recovery, desktop notices, recipient placement, phone target geometry and the simulator-command correction.
Standard generators use the existing local revision marker. No generated data changes remain.
Three credential-backed stores remain unmeasurable. Fresh browser, performance and native acceptance remain open.

## Fresh build and remaining browser coverage

Both [normal and keyless builds](../../.lavish/product-audit/assets/build-0f98.log) pass at `0f98a6740`.
Their version endpoints match the fully verified application source. New E2E fixtures pass scoped lint and full type checking.
The [77-case crosswalk](../../.lavish/product-audit/assets/unmatched-browser-crosswalk.md) maps unresolved original failures to 81 current identities across 36 files.
Independent review checks every original identity, source reference and retained result. All 77 remain open for current acceptance.
Nineteen have historical replacement or project passes. Fifty-eight have no retained result for the mapped case.
Four runnable groups cover Chromium, WebGL, keyless and Firefox. No renamed test counts as a fresh pass.

## Fresh browser results at 5145fc56b

Both [production-mode builds](../../.lavish/product-audit/assets/build-5145.log) pass. Their served version records match `5145fc56b`.
The [12-case UI run](../../.lavish/product-audit/assets/ui-5145.log) passes eight cases and fails four in 113.28 seconds.
Message search releases failed responses and retries successfully at both widths. Both mobile Search-history paths pass.
Desktop toolbar access and Escape focus restoration pass. Favourite pint visibility and its 44-pixel label checks also pass.

The remaining UI findings are precise:

- Fit measures 40 pixels high. `7eaf28497` removes the conflicting minimum and restores the existing 44-pixel rule.
- Layers starts on Key. `d7488d206` opens the actual Layers tab before the unchanged toggle checks.
- Alcohol-free changes the Filters label. `b93253053` uses that exact active-state name.
- The drawer recorder stops after the first exchange. It records one click although the subsequent Swift selection succeeds.

A later [three-fixture run](../../.lavish/product-audit/assets/fixtures-5145.log) passes alcohol-free and fails two cases.
Opening the real Layers tab exposes a 43-pixel POI chip. The 44-pixel requirement remains unchanged.
The corrected recorder captures both trusted venue selections within the same five-second observation window.
Swift is selected after the drawer settles at x=800. The strict mid-spring assertion fails.
No retained observation yet explains whether actionability or product behavior delayed that click.
Manual computer use confirms [Favourite pint visibility](../../.lavish/product-audit/assets/manual-5145-drink-desktop.png).
It also confirms [search beside venue details](../../.lavish/product-audit/assets/manual-5145-venue-search.png) and a successful Swift selection.
The in-app browser shows a blank basemap with Retry. These images certify control layout only.
The second image exposes a separate defect: the open drawer covers Retry.
The passing recipient screenshot also exposes default form styles and an overlapping greeting. A scoped visual fix is under review.

All [three settled-outage cases](../../.lavish/product-audit/assets/map-5145.log) remain red.
One instrumented case then records [50 caller events](../../.lavish/product-audit/assets/map-cdp-5145-caller.json), with no overflow.
All 12 executable locations and the served chunk hash were checked before fault injection.
Real vector-tile errors reach the caller with valid string keys. Tracking records each failure.
An unrelated successful tile does not clear those failures. Two silent source retries each clear every key and timestamp.
The final reset changes five failures to zero while both silent attempts remain spent. No later retry decision runs.
No recovery-retirement event was observed. This evidence supports a failure-retention fix, separate from the earlier motion fix.
The temporary diagnostic test was restored exactly. Its retained copy and descriptor preserve the observation method.
Three preceding setup attempts stopped before faults while checking the URL and V8 locations.

## Complete verification passes at 228888051

The [fifth verification attempt](../../.lavish/product-audit/assets/gate-attempt-5.log) exits zero.
It passes 17,041 unit tests and 374 PostgreSQL permission and migration tests. One unit test is skipped.
Lint reports zero errors and 23 complexity warnings. Type checking, dead-code checks, and the E2E skip inventory pass.
The dependency audit reports no high or critical vulnerabilities. Three credential-backed data stores remain explicitly unmeasurable.
The later E2E-only commit `5145fc56b` passes scoped lint and full type checking.
Both 5145 builds pass. Later product changes require a new build and gate. Complete acceptance remains open.

## Latest browser checks at 3e9f77ef5

Both [fresh builds](../../.lavish/product-audit/assets/build-3e9.log) pass, including TypeScript.
The [43-case browser run](../../.lavish/product-audit/assets/onboarding-3e9.log) records 37 passes and six failures in 39 seconds.
All nine matched onboarding cases pass at 320, 390, and 430 pixels, including both themes and the final note.
The original two-theme checks, two new-document reboot cases, and both Plan layout cases also pass.
Returning direct onboarding passes with diagnostics. This rerun does not establish the earlier failure's cause.

All six failures stop before onboarding. The real venue journey has already saved London as the preferred city.
The fixture expected no saved city, which contradicts the map's actual city write.
No stored city is cleared to force first-run eligibility. The subsequent corrected journeys pass below.

The separate [avatar reconnect case](../../.lavish/product-audit/assets/avatar-reconnect-3e9.log) passes in 583 milliseconds.
It observes the failed image, waits for two auth-bootstrap profile reads, then reconnects.
The image decodes after reconnect. The profile-read count remains exactly two.

The fourth `npm run verify` attempt stopped during coverage at source `e42fd058b`. The fifth attempt passes below.
The first attempt stopped on three lint errors in an ignored, temporary audit script.
That script is retained outside the repository scan. No lint rule or product source changed for the rerun.
The second attempt passed lint, then exposed two fixture type errors. Their correction passes 39 focused tests.
The third attempt passed type checking, then found an undeclared test dependency.
The real filter compiler is now an exact development dependency. Its installed and resolved versions remain 26.4.1.
Knip and all eight filter tests pass. The fourth full attempt includes these corrections and reaches the complete unit suite.
The fifth gate attempt reports zero lint errors and 23 complexity warnings.
The [warning review](../../.lavish/product-audit/assets/lint-warning-followups.md) separates useful refactors from necessary domain branches.

## Confirmed post-paint map recovery failure

All [three corrected map cases](../../.lavish/product-audit/assets/settled-map-3e9.log) fail on `3e9f77ef5` in 110.58 seconds.
Every case passes its completed initial tile witness and reaches the Retry assertion.

The mixed case now satisfies its transport premise.
Its successful tile returns 200 with 177,925 bytes. Five distinct zoom-13 tile URLs fail after the camera settles.
The [transport diagnostic](../../.lavish/product-audit/assets/settled-map-3e9-diagnostic.json) preserves their timing.
Retry remains absent for 20 seconds. The two other cases also miss Retry, within their unchanged 30-second limits.
The canceled-success fixture fault no longer explains this run.
Actual MapLibre error-event identities and recovery state remain unobserved. Focused caller tests are investigating the cause.

The final camera assertion was not reached. Its change-only trace needs an actual boundary sample before fault release.
This diagnostic correction remains separate from the failed Retry assertion.

## Corrected consent and response-cleanup checks

All [seven consent contracts](../../.lavish/product-audit/assets/consent-contracts-3e9.log) pass on `3e9f77ef5` in nine seconds.
Six widths earn second-route consent through actual informational-page visits, then follow the real root handoff.
The application clears that answer during onboarding, as its entry policy requires. The prompt stays absent.
The separate venue journey preserves London and its genuine venue answer on a returning root visit.
These cases replace an impossible fixture path. They do not establish simultaneous earned-consent and onboarding overlap.
The nine separately labeled geometry cases retain that isolated layout scope.

Recipient cleanup is integrated as `397a98399`. Five [focused files](../../.lavish/product-audit/assets/recipient-fence-green.log) pass 30 tests.
The open-stream regressions confirm cancellation before another input or account change.
The source fences, planner ownership, and gallery-route certification also pass in that run.
Fresh browser response-release acceptance awaits the next build.

The [actual map-caller run](../../.lavish/product-audit/assets/map-motion-caller-red.log) records two failures and 19 passes under Vitest 5.0.0.
Recovery does not resume after movement in either failed case. The healthy-final-viewport control passes.
This source-level finding remains separate from the settled-browser failure. Both still need a verified fix.

## Current full-gate failures

The [fourth gate log](../../.lavish/product-audit/assets/gate-attempt-4.log) records 17,006 passed tests, ten failures, and one skip.
Nine files fail. Coverage runs for 182.22 seconds. Later PostgreSQL and dependency-audit stages do not run.
The [complete failure output](../../.lavish/product-audit/assets/gate-unit-failures.txt) preserves each assertion.

Two findings need actual implementation fixes.
Social posts and gallery uploads lack a complete account-export lane. The new gallery store exposes this existing coverage gap.
Recipient search throws after a failed response without releasing its body.
The [browser reproduction](../../.lavish/product-audit/assets/recipient-body-red.log) confirms an unread actual response at 390 and 1440 pixels.
The error is visible before inspection. No subsequent input, retry, or unmount has occurred.
This proves missing body release. It does not establish a stalled network connection.

The remaining failures concern reviewed inventories, shared ownership checks, and local review assets.
The [59 focused checks](../../.lavish/product-audit/assets/fence-corrections.log) pass after correcting four of those checks.
The deployed upload now excludes `.lavish/`, which held 67 MB of review evidence during the failed test.
Planner and gallery-route certification corrections are integrated. Their full-gate acceptance remains pending.

## Complete browser run and next repair batch

The complete frozen `ad3af9599` run took 45.8 minutes with two workers and no retries.
It recorded 938 passed, 200 failed, 21 skipped, and 13 not run.
The [full log](../../.lavish/product-audit/assets/full-ad3.log) and [failure ledger](../../.lavish/product-audit/assets/full-ad3-failure-ledger.md) retain every result.
The JSON reporter combines skipped and not-run cases as 34. The text reporter separates them.

The earlier exact-title ledger mapped 105 original failures to later passes.
The [expanded reconciliation](../../.lavish/product-audit/assets/after-sep12/exact-browser-reconciliation.json) reads 74 retained Playwright reports.
It matches 155 original failures to later historical passes, using exact file, project and full test title.
Twenty-four later exact-title results remain red. Twenty-one retain only the original failed result.
The default read-only inventory contains 1,175 cases. Optional Firefox and WebKit projects expand it to 1,207.
Of the 45 unresolved exact-title records, 22 remain in that expanded inventory.
The [complete manual mapping](../../.lavish/product-audit/assets/after-sep12/comprehensive-browser-title-mapping.json) covers all 23 records outside the expanded exact-title inventory.
Twenty-two have passing successor records with zero retries. All successor keys are unique in the current inventory.
Three graphics cases moved to the WebGL project. Other changes reflect current navigation, consent, tour and card contracts.
The keyless successor requires a refused price write to retain its draft, then permits an unpriced note.
The remaining mapped tab-layout case still fails and retains its existing approval hold.
Together, these records reconcile 177 original failures to later historical passes. Twenty-three remain unresolved.
This evidence does not establish latest-build acceptance or release clearance.

Real failures include account-menu stacking, pub-photo overlap, and map tile and context recovery.
Other cases use retired controls, obsolete headings, or incomplete authentication fixtures.
A shared per-address limit affected four Crawl Stop scenarios. Production limits remain unchanged.
The host model key also entered the keyless runtime. The next configuration explicitly clears it.
Database credentials were absent during that run. The secondary keyless configuration now clears them explicitly.

Reviewed repairs are integrated at `605249b97`. All [23 focused checks](../../.lavish/product-audit/assets/integrated-recovery-unit.log) pass.
Fresh browser acceptance and native checks remain open. No release clearance is claimed.

## Repair browser checks at 605249b97

Both fresh builds passed. Model and durable database keys were absent from both server environments.
The [graphics recovery run](../../.lavish/product-audit/assets/recovery-gl.log) passed six cases and failed one.
Transient tile recovery and all three context-loss sequences pass. Permanent tile failure still misses the style retry.

The [UI repair run](../../.lavish/product-audit/assets/recovery-ui.log) passed 104 cases and failed four.
All 12 account-switch cases, eight Messages sizes/themes, and four real five/six-stop crawls pass.
Photo bounds, credit containment, metadata, and actions pass at 390 and 1440 pixels.
These [photo captures](../../.lavish/product-audit/assets/photo-card-bounds-390.png) still show dim credit under a decorative overlay. That later correction needs fresh rendering.

A single-click [landmark trace](../../.lavish/product-audit/assets/landmark-handoff-events.json) shows visible pub choices replaced during pointer scrolling.
No row click or venue request reached the application. This trace does not prove a lost accepted navigation.
The directory privacy read hit a shared process quota after account-switch cases. Its standalone rerun remains open.
Two Activity cases reached valid signed-in content, then failed against retired heading and link assumptions.

## Repair browser checks at 81519fe99

Both new production-mode builds passed, including TypeScript. All [49 focused source checks](../../.lavish/product-audit/assets/closures-unit.log) passed.
The [UI run](../../.lavish/product-audit/assets/closures-ui.log) recorded 54 passed and 17 failed across 71 cases.
All 14 profile photo crop cases pass in Chromium and WebKit, including the fresh profile image after upload.
All three Activity cases, three Near Desk cases, and three Near acceptance cases pass.
All three first-visit widths pass real pin, arrival strip, hit target, and Search checks.

The [graphics run](../../.lavish/product-audit/assets/closures-gl.log) recorded 16 passed, one failed, and ten not run.
Permanent tile outage now reaches its style retry. Manual Retry and automatic basemap recovery both pass.
The failure occurred before fault injection: a stale fixture expected tile readiness where phones now report pin readiness.
A corrected fixture requires a completed real basemap tile before injecting the outage. Its follow-up run remains separate.
The ten later cases were skipped by serial execution. Independent cases now run after an earlier failure.

The [single-click landmark trace](../../.lavish/product-audit/assets/landmark-handoff-815-events.json) records one trusted tap on Lamb and Flag.
The venue request returns 200, the URL retains the landmark and selected venue, and the venue sheet opens.
The main case passes its first opening and sheet Back. Its second opening reuses an obsolete name after story remount.
A separate fixture repair will select the current visible row and preserve both Back journeys.

Both pub photo checks fail image decoding before geometry or credit measurements.
Six upstream photos become fallbacks, and the dynamic test locator moves to a later lazy image.
The image request status remains unmeasured. The credit correction therefore has no fresh rendered acceptance yet.
Other failures include hidden responsive city text, a stale utility count, and broad API fixture matches.
These failures remain in the [complete targeted JSON](../../.lavish/product-audit/assets/closures-ui.json). They do not establish native or release acceptance.

## Further diagnostics on the same 81519fe99 build

The [complete graphics follow-up](../../.lavish/product-audit/assets/gl-followup-815.log) records 17 passed and four failed in 5.5 minutes.
Every selected case ran. The service-worker case passes takeover, cache continuity, poisoned-tile removal, real tile delivery, and the pub list.
One failure remains under diagnosis: multiple failed tile requests do not produce Retry after the basemap has painted.
The fixture may count requests canceled by later zooms. Delivered errors need further observation before a product cause is established.
The [before screenshot](../../.lavish/product-audit/assets/gl-postpaint-815-before.png) and completed tile response establish that initial rendering succeeded.
Two other failures stop at obsolete phone readiness assertions. Manchester stops before opening its Layers control.

A [standalone gallery probe](../../.lavish/product-audit/assets/gallery-network-815.json) loads six real proxy images with HTTP 200.
The Blackfriar image decodes at 384 by 257 pixels from 20,300 bytes.
Its [phone screenshot](../../.lavish/product-audit/assets/gallery-network-815-phone.png) shows the corrected white photo credit and contained image.
This later pass does not identify the earlier batch's failed response status. Both viewport geometry retests remain separate.

The [avatar wire trace](../../.lavish/product-audit/assets/avatar-reconnect-815.json) identifies an early test action.
The fixture dispatches online before the first profile answer and before the first avatar request returns 503.
It matched the initial loading fallback. This trace does not prove a broken post-failure reconnect.
The corrected fixture must observe the initial failed image before dispatching online.

## Broader journey checks on 81519fe99

The [latest 207 cases](../../.lavish/product-audit/assets/journeys-815.log) finished in seven minutes: 174 passed, 24 failed, and nine skipped.
The run covers 39 executed spec files. Application source is `81519fe99`; reviewed fixture source is `41fa0274c`.
The [per-file counts](../../.lavish/product-audit/assets/journeys-815-counts.json) and [24 failures](../../.lavish/product-audit/assets/journeys-815-failures.json) preserve the exact scope.

All six landmark cases now pass, including one normal tap for each own-Back and browser-Back journey.
The [390-pixel photo card](../../.lavish/product-audit/assets/photo-card-815-390.png) and [1440-pixel photo card](../../.lavish/product-audit/assets/photo-card-815-1440.png) pass real image decode, credit, geometry, and metadata checks.
Social notification and feed Retry cases pass after separating their actual API fixture responses.
Plan creation, invitation, route editing, and receipt workflows have passing cases recorded in the per-file table.
The real deferred tour waits 30 seconds before opening. This does not validate its separate stale legend assertion.

Onboarding in light and dark reaches the companion but exposes only 51.031% of its main button.
Two push cases reach the correct current prompt but expect its obsolete name. Their negative assertions need correction too.
Returning direct onboarding lands at root instead of Tonight. Its entry marker sequence remains under diagnosis.
Six consent cases stop at a hidden consent prerequisite on the map, before any onboarding assertion.
Four shared-sheet cases stop at an added hidden tab-bar measurement: 905.6 versus viewport height 844.
This does not measure portal height. The original bottom-anchor requirement remains intact.
Other failures concern current controls, incomplete receipt response fixtures, and the Tonight share action.
No timeouts, safety limits, or acceptance thresholds were relaxed to clear these failures.

## Onboarding and map checks at f9a5d1677

The [33 targeted UI cases](../../.lavish/product-audit/assets/onboarding-f9a.log) record 26 passes and seven failures.
The nine matched onboarding cases improve from seven failures to two failures.
All primary actions pass visibility, initial scroll, image decode, keyboard access, and 44-pixel hit-target checks.
Both remaining geometry failures concern the final note at 320 pixels: its visible ratio is 0.996897.
A further eight-pixel panel inset is integrated. Its fresh build and matched checks remain pending.

Both Plan price missions and both instrumented Tonight Share cases pass.
The Share rerun does not establish a prior hydration cause.
Two reboot checks reused the same tab session. Their reviewed fixture now starts a fresh page with preserved durable state.
This models a new document session. It does not prove a native process reboot.
Returning direct onboarding still lands at root. Its marker and platform diagnostics remain active.
The Local selector matched both Describe and Describe with voice. It now names the exact launcher.

The [avatar trace](../../.lavish/product-audit/assets/avatar-reconnect-f9a.json) records two profile reads before online.
A component regression reproduces the second read during the unresolved-to-signed-out auth transition.
The image reconnect itself must add no metadata read. Its corrected fixture awaits both bootstrap reads first.

The [four map diagnostics](../../.lavish/product-audit/assets/map-diagnostic-f9a.log) record one pass and three failures.
Manchester Layers and Show all pass.
The one-reload case stops before fault injection while awaiting the first header response's completion.
The next witness will accept a real completed tile with a nonempty body within the existing 30-second bound.
The mixed-outage trace records no successful post-fault tile. Its intended success was canceled before release.
Ten requests still fail after the camera settles. This leaves recovery behavior open; cancellation alone does not clear it.

## Separate database candidate proof

Candidate `05fbbb26150def2dd6f68e8bdf4adf14e6a532d2` passes all 96 effective migration cases with Vitest 5.0.0.
The [full log](../../.lavish/product-audit/assets/group-outcome-0158-green.log) records exit zero and 55.37 seconds.
The owned PostgreSQL cluster, temporary directory, and resource slot were removed after the run.
This source-specific result belongs to the separate group-outcome candidate. It is not integrated into the audited application build.
The earlier two deadlock reproductions used Vitest 4.1.11. Their raw evidence remains valid with that original toolchain label.
No production migration or deployment follows from this result.

## Completed verification

<!-- AUDIT_UPDATE:stable-gate -->

The earlier stable `npm run verify` exited with code 0. It predates the current application source. Its [full log](../../.lavish/product-audit/assets/verify-stable.log) is retained.

| Check | Result |
| --- | --- |
| Unit and regression suite | 16,413 passed; one existing skip. 1,544 files passed; one skipped. |
| PostgreSQL and row-level security | 372 tests passed across 32 files. |
| Lint | Zero errors; 41 warnings at this gate: 35 complexity and six navigation warnings. No thresholds lowered or suppressions added. |
| Type checking and dead-code checks | Passed. |
| Conditional browser-skip gate | Passed across 222 specs. |
| Data validation and local freshness | Passed. Production timestamp reads resolved three unmeasured feeds. |
| Dependency audit | No high or critical findings. |
| Coverage | Statements 81.93%; branches 75.22%; functions 86.10%; lines 85.66%. |

The stable gate preceded the coverage-only correction `c22a94980`.
That correction excludes `**/*.md`, which removes two Markdown parser warnings.
Its glob check retains 1,187 executable files. All 10 trusted-signing tests pass.
It does not supply a new full-gate result for that later commit.
Earlier broad runs occurred during concurrent edits. Their failures are diagnostic history, not the current gate result.
Later changes removed one complexity warning and five navigation warnings, then separated additional validation and search responsibilities.
Full lint has not rerun after those changes. The current total is unmeasured.
The `AdminTokenForm` document reload remains intentional. Commit `02531d160` reloads the confirmed moderator document.

## Confirmed fixes

| Defect | Commit | Evidence |
| --- | --- | --- |
| Malformed admin cookies throw; scalar auth JSON reaches unsafe reads. | `3bf316daf` | Actual handler failures reproduced. Route and guard tests pass. |
| Anonymous callers can reserve a handle with durable storage configured. | `85998ec71` | New handle writes return 401. Existing legacy and keyless contracts remain. |
| Pint, bill, and venue image uploads can corrupt bytes. | `af29ab0f7` | Shared Blob writer and read-back proof. Tests reproduce real encoding and corrupt storage. |
| Failed CacheStorage access blocks valid network responses. | `ad09876cc` | Browser fault reproduced. Network reads survive denied cache access. |
| Deferred cache writes clone an already-consumed response. | `182eed235` | Real-response regression fails before and passes after. All 39 cache tests pass. |
| Search treats a streamed London subset as the complete city. | `c68a16bfe` | 141 core venues versus 1,995 London venues. Complete-pack indexing and retry tests pass. |
| Tonight links fail contrast in light mode. | `01bb53d34` | Axe fails before and passes after at 390 and 1,440 pixels in both themes. |
| Dead code and incorrect hook dependencies create lint warnings. | `d78c4f3eb` | 28 warnings removed. 387 focused tests across 23 files pass. No suppressions added. |
| Capacitor tooling uses an affected XML parser. | `7d1bfa12d` | Compatible update. Fault reproduction, plist round trips, and a clean temporary install pass. |
| The profile ownership module lacks its server-only boundary. | `5d2462cef` | The guard and auth checks pass 100 focused tests. |
| Identity refresh closes the composer. | `23e3a2073` | Shared fix integrated. Independent review is clear. 70 focused tests and the owner's direct two-tab test pass. |
| The underlying map list takes Escape from the open drawer. | `d6edf1578` | Current-surface routing. 132 focused tests and the updated-build browser check pass. |
| Escape closes both a global popover and its underlying List. | `1bf4772cd`, `ef405f1a2` | Root computer use reproduced Layers + List and Sign in + List faults at `23e3a2073`. Shared Escape ownership passes 159 and 90 focused tests. Independent standards review is clear. Fresh-build Layers + List and More pages + List checks pass. |
| One held or failed detail read hides loaded Crawl Stops. | `1ad2e0a7a` | Controlled E2E reproduced zero cards while one read stayed pending. A 503 then left two cards without Retry. Incremental cards, read status, and Retry pass 16 focused tests. Lint has zero errors. Independent source review and the fresh-build failure and Retry journey pass. |

Independent correctness review covered fixes through `01bb53d34`, before later changes.
It passed 148 tests across 19 files. This source review does not certify a deployment.
Standards review found a clock-dependent arrival test, corrected in `a586da1b4`.
Spec review found the deferred cache-write race, corrected in `182eed235`.
Both re-reviews through `5d2462cef` report no remaining actionable findings within their reviewed scope.

## Later source changes awaiting browser proof

These changes followed the historical `1ad2e0a7a` build. Later runs above provide separate, source-specific acceptance.

| Change | Commit | Evidence and remaining proof |
| --- | --- | --- |
| Crawl Stop cards precede discovery on desktop and phone. | `505682d72` | 80 unit tests pass. Fresh 1280px and 390px viewport checks pass at `a88c86d1f`. |
| Root auth callbacks survive both native entry paths. | `79d3095eb`, `d533a4a02` | The callback work passes 83 focused tests. Actual native sign-in remains open. |
| Native first-run navigation keeps the client route instead of making a hard redirect. | `815152f92` | 71 focused tests pass. Actual iOS and Android acceptance remains open. |
| The landing FAQ states that a bill photo is required. | `b091f53bd` | Copy corrected. Updated-build browser proof remains open. |
| Stale browser fixtures follow current prompt and layout contracts. | `943bb4167` | No forced clicks or timeout increases. The next full browser run must validate the repairs. |
| The profile editor heading uses `--ink`. | `efda4b4a8` | The contrast fault reproduced in production. Updated-build contrast proof remains open. |
| Receipt controls use readable text, borders, and focus rings across themes. | `e3dae684d` | Reviewed and integrated. Fresh light and dark browser measurements pass at `a88c86d1f`. Baseline failures remain below. |
| New message opens recipient search and waits for identity. | `411138dfd`, `c507d2677` | Root computer use confirms production New message points to `/social`. Four unit tests pass. Independent source review is clear. All four prepared browser cases pass at `a88c86d1f`, covering phone and desktop. |
| Plan controls explain validation and fit the route layout. | `34ef11526` | Original owner commit `7dbe23cde`. Independent source review is clear. Two development browser cases and 85 unit tests pass. Both layout cases also pass on the fresh production-mode build. |
| Populated menus omit repeated instructions. | `8d8f56f1b` | 16 focused tests pass. Updated-build browser acceptance remains pending. |
| Phone Plan reads follow current authority and recover through Retry and the floating action button. | `10a4716c7` | 61 focused unit tests pass. Both fresh browser recovery cases pass. Earlier development limits remain historical. |
| Shard entry parsing is separate from its caller. | `fc959ce90` | 31 focused tests pass. One complexity warning is removed. Full lint has not rerun. |
| Five Pub Pal proposal navigations use the client router. | `de7aa5189` | 40 focused tests pass. Five navigation warnings are removed. The intentional admin document reload stays. |
| Pint savings follow the active account and Drink Measure; Out separates unavailable venue matching from absence. | `cee6e19f0`, `0bc50d86d` | The owner's 88-unit-test pass is followed by two savings and all 11 Out browser cases passing at `ad3af9599`. These fixture-backed checks do not establish current production acceptance or FAQ coverage. |
| Marked performance routes always take seven samples. | `f9c2c304c` | The shared 88-unit-test pass and two sampler browser cases pass. This proves sample count, not production performance. |
| Pub research uses the requested month and supported locations and credits. | `6d72250b5`, `28d500bca` | 34 tests pass. Independent source review is clear. Caption checks do not prove video playback. |
| Minor dependency main is integrated with Next 16.3.4 locked. | `be63292e0` | Merges `61f001e4a`. `npm ci` and native-tool smoke checks pass at `ac40a445a`. Both fresh app builds pass at `a88c86d1f`. Full gates remain pending. |
| Pub card photos fit the measured image budget. | `e0d33ce22`, `5249e58cf` | Controlled actual proxy GET and SSR browser replay reduced five images from 249,502 to 74,770 bytes. 55 unit tests pass. Two independent source reviews are clear. Both fresh builds and the mobile pub-gallery browser case pass. The five-image byte measurement remains controlled replay proof. |
| Social invite actions reserve the shared floating action button lane. | `d60c26427` | Initial production checks had no overlap. A controlled candidate at 390 and 430 pixels, in both themes, changed 46 × 44 overlap to a 12-pixel gap. All nine sampled points were reachable after. 14 unit tests pass. All four fresh browser cases pass across both widths and themes. |
| The inbox uses one heading. | `64f454d00` | 21 existing message and Screen tests pass. Scoped lint passes. Browser after proof remains pending. |
| Android offline Retry preserves the failed venue URL. | `ac40a445a` | Original `a633144fb`. Two independent source reviews are clear. Actual Android venue Retry preserved the query and fragment. Twelve JUnit tests, one template test, and one installed instrumentation case pass. Wider native limits remain below. |
| Validation and search functions have separate responsibilities. | `12dcd1558`, `d995f8bc2`, `2c115928a`, `9479431aa`, `00c96580f`, `0080de48a` | Source history records provenance, integer, Plan anchor, late-food, harvest, Night Signal, and local-area extractions. Full lint remains unmeasured. |
| The moderator entry reloads the confirmed document; Activity uses one heading. | `02531d160`, `139f7f4b5` | Source changes are integrated. The guarded admin reload passes browser acceptance. Activity acceptance remains pending. |
| Research credits support the complete displayed claims. | `51ae20326` | Original `a0a34c3cc`. Two baseline failures become 36 passing focused tests. Generator roundtrips and independent source review pass. |
| Production Messages cannot fall back to process memory. | `5d82101ab`, `6657dd712`, `6646034ff` | Guards cover opening, sending, inboxes, thread reads, read markers, participants, reports, and photo lookup. Local demo behavior remains. |
| Failed message reads preserve the thread and expose Retry. | `a65f8b9a6` | Actual component, route, and store tests reproduce seven failures. All ten cases then pass within the final 137-test focused run. |
| Legal-page links use the existing readable ink token. | `08920690b` | Actual phone colors yield 2.88:1 baseline contrast. The replacement token calculates 5.53:1. Rendered after proof remains pending. |

The [Plan layout proof report](../proof/plan-layout/report.md) states its fixture data and development-server limits.
Its screenshots show development browser runs, not production or native shells.
Commit `7bb7c216c` changes native ownership comments only. It adds no runtime or acceptance result.
The [surface-state proof](../proof/surface-state-closeout/README.md) records the shared 88-test scope and browser-fixture limits.
Its research handoff is baseline-only. The current [research README](../../data/hyped-pubs-research/README.md) supersedes those older counts.

The [image budget proof](../proof/pubs-image-budget.md) uses actual patched server rendering and the actual image proxy handler.
Only upstream image fetches replay retained production bodies. Fresh builds now pass separately; the byte result still covers those five images.
The retained [measurements](../../.lavish/product-audit/assets/pubs-image-budget-browser-patch.json) and [phone comparison](../../.lavish/product-audit/assets/pubs-image-budget-phone-comparison.png) preserve that scope.
Changed source images require another check. The original-byte transform fallback can exceed the measured budget.

The [Social invite proof](../proof/social-invite-clearance/README.md) separates production from a controlled source-layout candidate.
Production `6a759e0ac` had no initial overlap at either width or theme.
The candidate placed the invite in the floating action button's vertical band by ordinary scrolling.
Its before/after captures are fixture evidence, not a complete Social build or native safe-area proof.
The [recipient-entry baseline](../../.lavish/product-audit/assets/message-entry-before.md) records the independent production navigation check.
The [inbox heading test log](../../.lavish/product-audit/assets/message-heading.log) retains the later 21-test result.
Commit `04c716a80` corrects the Android proof scope. It records no measured cause for the earlier launch-intent result.
The earlier production inspection opened no conversation and sent no message. No private inbox screenshot is retained.

### Current research scope

The research window is 8 August through 7 September 2026, inclusive.
The reviewed pack has 34 pubs, 97 source occurrences, 80 unique URLs, and 24 valid map IDs.
Exact retained TikTok captions were checked. Videos were not replayed in this pass.
Publication dates determine eligibility. Capture dates do not turn older mentions into recent ones.

Credit correction `51ae20326` selects Dickens comment `p7ym9tn` for roast and dock views.
It selects Pelton comment `p7cs1kz` for live music and the drinks surcharge.
Both retained excerpts support the complete displayed claim. Only source order changes; dates, counts, scores, and IDs remain intact.
The [credit evidence](../../.lavish/product-audit/assets/research-credit-summary.md) retains excerpts, recorded commands, and generator roundtrips.
The original corpus dates remain research metadata. Reopening a source does not establish a new publication date.

### Messages durability and read recovery

Production memory guards are integrated through `6646034ff`. Commit `6657dd712` corrects the identity and outage contract.
Read recovery `a65f8b9a6` maps unavailable durable reads to retryable 503 responses.
The existing thread component retains loaded messages. A failed first read exposes its existing Retry control.
Genuine missing threads remain 404. Healthy empty threads remain 200.
Reporting and photo sending stop when the membership read fails. The focused cases assert no database writes.

The [red log](../../.lavish/product-audit/assets/thread-read-red.log) records seven failures among ten cases.
The [final log](../../.lavish/product-audit/assets/thread-read-final.log) records 137 passes across 12 files.
All ten fault cases pass in that run. The retained [scoped lint log](../../.lavish/product-audit/assets/thread-read-lint.log) is empty.
The owner recorded a successful lint exit. An empty log alone does not record an exit code.
The [proof scope](../../.lavish/product-audit/assets/messages-read-summary.md) distinguishes real application layers from controlled dependencies.
These tests render the actual component over actual route handlers and the durable store in jsdom.
Database replies, authentication, realtime, and selected child components are controlled test dependencies.
They do not prove a live database outage, deployed browser recovery, or root aggregate verification.
The owner logs retain an older Vitest configuration warning. The root configuration rename is integrated separately.

### Later legal-link correction

Root computer use measured `/terms` links as `rgb(255,90,95)` on `rgb(250,248,245)`, at 16px and weight 600.
Those measured colors calculate 2.88:1 contrast. Commit `08920690b` changes `.legalLink` from `--brass` to existing `--brass-ink`.
The light token `#b43b1d` calculates 5.53:1. This is a prediction, not rendered after proof.
Production `/about`, `/privacy`, and `/terms` had no horizontal overflow at 390 by 844 pixels. Each had one main landmark.
The screenshots were viewed but not retained. Fresh-build after proof remains pending.
No legal text changed. These checks do not certify legal accuracy.

### Receipt contrast baseline

The [measured red log](../../.lavish/product-audit/assets/receipt-contrast-measured-red.log) records two failed browser cases.
Light text contrast measured 1.999:1. Dark text contrast measured 4.109:1. Light focus contrast measured 2.220:1.
The [light](../../.lavish/product-audit/assets/receipt-light-resting.png) and [dark](../../.lavish/product-audit/assets/receipt-dark-resting.png) screenshots show the browser baseline.
Hover and focus screenshots are also retained. They are baseline captures, not updated-build acceptance.
The [predicted ratios](../../.lavish/product-audit/assets/receipt-contrast-predicted.json) are calculations from baseline pixels. They do not prove the rendered fix.

### Receipt storage and open policy choices

Receipt migration `0153` is applied in production as version `20260907215709`.
The owner verified three nullable photo columns. No further application of this migration is pending here.
The existing availability policy can save a priced row without a receipt when storage fails.
Uploader read-back proof does not prove that the priced-row route refuses that fallback.
The user's receipt-policy choice remains with the parent task.
The parent also holds the map-literal choice: requested `6/+4` versus merged alternatives `8/4` or `-8`.
This report does not change either policy.
The earlier account-switch draft leak and display race are corrected through original receipt source `87e287bb2`.
Integrated commits `b2d48ca7e`, `a79887b8e`, and `ad44f9832` carry the final ownership guards. Source review is clear.
Fresh receipt Retry proves both bill and pint photo bytes match the chosen file on each attempt.
It also proves the price and form survive failure, failed optimistic rows disappear, and a successful retry clears the form.
Every write is intercepted. This is browser fixture proof, not a live storage outage or production submission.
Commit `e85989ebf` separately cleans omitted receipt objects and records removal errors.

## Browser evidence and remaining checks

### Fresh frozen-build result

Freeze: `a88c86d1f127ee9833a00e3754be13a64fde4ace`. Both normal and keyless builds and their TypeScript stages passed.
The [targeted log](../../.lavish/product-audit/assets/integrated-targeted.log) and [JSON result](../../.lavish/product-audit/assets/integrated-targeted.json) record 70 cases in 7.4 minutes.
There are 67 passes, three failures, no skips, and no flaky results. One worker ran the cases.
The [case summary](../../.lavish/product-audit/assets/integrated-targeted-summary.json) preserves every title and result.

| Fresh scope | Passed | Failed |
| --- | ---: | ---: |
| Admin document and confirmed reload | 3 | 0 |
| Arrival | 9 | 0 |
| Crawl Stop cards, ordering, and Retry | 6 | 0 |
| Dark surfaces and receipt contrast | 6 | 0 |
| Map accessibility and console checks | 9 | 2 |
| Message recipient entry | 4 | 0 |
| Mobile pub gallery | 1 | 0 |
| Plan layout and recovery | 4 | 0 |
| Social composer | 15 | 0 |
| Social gallery and video viewer | 5 | 1 |
| Social invite clearance | 4 | 0 |
| Receipt Retry byte preservation | 1 | 0 |

The two map failures stop at stale assertions: exact `Filters: venue types` and retired `.mapCompassBtn`.
Both corrected fixtures pass on the same a88c86d1f artifact. The separate retest records two passes in 41.6 seconds.
The Social manual Clear-draft retry leaves Post disabled. Its [failure context](../../.lavish/product-audit/assets/integrated-social-clear-error.md) is retained.
The root cause was editable fields during asynchronous storage cleanup. Fix `3a7b31e3c` disables edits through both deletion steps.
All six gallery cases pass on the new ad3af9599 artifact, including immediate typing and saved-post recovery after reload.

The full browser suite collects 1,172 cases in 232 files. Collection is not execution.
The [collection record](../../.lavish/product-audit/assets/integrated-collected.txt) contains the inventory only.
Full browser execution, full verify, performance budgets, migration application, and actual iOS acceptance remain open.
These local production-mode browser checks use controlled route, auth, and media fixtures. They are not deployed-production or native proof.

### Fresh receipt contrast

The [measured browser attachment](../../.lavish/product-audit/assets/integrated-receipt-measurements.json) records resting, hover, and focus states.
Resting text contrast is 13.589:1 in light mode and 10.526:1 in dark mode.
Focused outline contrast is 4.262:1 in light mode and 4.822:1 in dark mode.
The [light](../../.lavish/product-audit/assets/integrated-receipt-light-resting.png) and [dark](../../.lavish/product-audit/assets/integrated-receipt-dark-resting.png) captures show the rendered result.
Earlier pixel calculations and baseline screenshots retain their original scope. They are not the source of these after measurements.

### Fresh Social gallery and video proof

The [gallery](../../.lavish/product-audit/assets/integrated-gallery-390-light.png) and [video viewer](../../.lavish/product-audit/assets/integrated-video-390.png) captures come from this frozen build.
Accounts, posts, and media are test fixtures. The synthetic video is not footage of a real Social contribution.
The viewer case checks decode readiness, playback start, one viewer player, navigation, swipe, focus restoration, and axe.
The screenshot captures the second video's paused or loading state. It does not itself prove playback completion.
Gallery upload Retry, selected order, keyboard use, swipe, resizing, and both themes pass.
One manual Clear-draft recovery case remains open. Passing gallery cases do not close that separate failure.

### Earlier focused browser evidence

<!-- AUDIT_UPDATE:final-browser -->

The earlier build at `23e3a2073` passed all 30 critical browser checks in 3.8 minutes.
The [retained log](../../.lavish/product-audit/assets/critical-browser.log) covers guest return, crawl cards, arrival, founding links, landmarks, and map accessibility.
Map coverage includes keyboard focus, camera movement, filters, contrast, and rapid reselection.
The separate [reduced-motion arrival check](../../.lavish/product-audit/assets/arrival-reduced-motion.log) passes one test against that build.
Root computer use separately confirms that Browse without signing in returns to Arnos.
This is a focused run, not the complete browser suite.
Those results preceded the global Escape and failed-detail fixes.
The local production-mode build at `1ad2e0a7a` passed all 23 targeted browser checks in 3.5 minutes.
The [fresh targeted log](../../.lavish/product-audit/assets/final-targeted-browser.log) covers all four crawl-card cases, arrival, and map accessibility.
It includes held and failed detail reads, Retry, reduced motion, Layers + List, More pages + List, focus, and contrast.
Root confirmed that run's `/api/version` reported `1ad2e0a7a`, built at `2026-09-07T21:33:08.967Z`.
That result remains scoped to the earlier build. The new `a88c86d1f` result is recorded above.
The full browser suite remains open. These 23 checks overlap the earlier 30 and must not be added together.
The [manual Sign in + List check](../../.lavish/product-audit/assets/manual-escape-check.md) also passes on verified fresh HTML.
Escape closes Sign in, keeps the London list visible, and restores focus to Sign in.
An earlier manual attempt received cached old HTML. That attempt does not count as fresh-build evidence.

| Finding | Completed evidence | Remaining proof |
| --- | --- | --- |
| PUB-8: leaving sign-in loses the selected pub. | `0595f340c`. 54 focused tests, updated-build E2E, and manual Arnos return pass. | Issue status remains In Progress. |
| PUB-9: a saved crawl names three stops but shows no stop cards. | `1ad2e0a7a` passes data recovery checks. `505682d72` moves cards before discovery and passes 80 unit tests. | Fresh desktop and phone first-viewport checks pass at `a88c86d1f`. Release verification remains. |
| PUB-10: arrival greeting covers Day/Tonight at 390 pixels. | `39d8b2f8b`. Updated-build phone, desktop, founding, and keyboard checks pass. | Explicit reduced-motion case also passes against the updated build. Release verification remains. |
| Map keyboard and camera controls | The earlier map-accessibility checks passed, including rapid reselection. Later global Escape fixes pass focused tests and independent standards review. | Fresh-build Layers + List and More pages + List pass. Root manual Sign in + List acceptance also passes. |

PUB-8, PUB-9, and PUB-10 comments received the earlier evidence. Their last recorded statuses are In Progress.
The [arrival comparison](../../.lavish/product-audit/index.html#arrival-proof) uses actual baseline and updated-build screenshots.
The displayed after images come from the fresh `1ad2e0a7a` run. Earlier `23e3a2073` images remain in the evidence bundle.
These are local browser captures. They are not production or native proof.
The dock clears the selector and Create control while preserving the live region, timed greeting, and keyboard use.
Earlier CSS-preview evidence remains labelled separately. Its lifecycle probe records no layout-shift entries.
A rejected dynamic-margin prototype moved the selector twice by 52 pixels. That approach is not in the fix.

### PUB-9 controlled failure

The failed-detail reproduction blocked service workers with `serviceWorkers: "block"` so route interception controlled the read.
It also blocked background venue cells, which could otherwise supply the held Crawl Stop.
The old build showed zero cards while one detail read stayed pending, although two stops had resolved.
After that read returned 503, two cards appeared. The missing stop had no failure status or Retry control.
The [held-read screenshot](../../.lavish/product-audit/assets/crawl-held-before.png) and [failed-read screenshot](../../.lavish/product-audit/assets/crawl-failed-before.png) retain this baseline.
The [failure context](../../.lavish/product-audit/assets/crawl-retry-before.md) records the card counts and missing controls.

Commit `1ad2e0a7a` renders resolved stops incrementally and distinguishes loading, failed, and missing details.
It adds Retry and keeps export and progress controls disabled until the crawl is complete.
The focused tests, review, and all four crawl-card browser cases pass against `1ad2e0a7a`.
The browser case retains two resolved cards, exposes the failed stop, retries it, and restores the third card.
Its raw panel screenshots contain large blank areas and omit the tested cards and status. They do not supply visual acceptance.

### PUB-9 earlier layout finding and current proof

Root computer use confirmed a separate placement fault on fresh `1ad2e0a7a` HTML at 1280 × 720.
The initial planner shows the hero, search, and Featured routes.
The route panel starts at y4694 and measures 4193 pixels high. The first Crawl Stop starts at y5756.
The cards load, but the first card sits roughly eight screens below entry.
The [manual layout record](../../.lavish/product-audit/assets/manual-crawl-layout.md) retains these measurements.
At that earlier head, the 23-test pass proved data recovery while the layout fault remained open.
Commit `505682d72` now places existing Crawl Stops before discovery on desktop and phone. Its 80 unit tests pass.
The old build did not contain that change. Fresh desktop and phone viewport checks now pass at `a88c86d1f`.
The [desktop](../../.lavish/product-audit/assets/integrated-crawl-1280.png) and [phone](../../.lavish/product-audit/assets/integrated-crawl-390.png) captures show Crawl Stops at entry.
The six current crawl cases also cover Retry, distinct same-name venues, walking, and transit copy.
These captures prove planner placement. They do not certify the map background or a production release.

Completed focused browser runs:

- Consent and reduced motion: seven passed.
- Design checks: 16 passed across completed focused runs.
- Launch control geometry: six passed at 360, 390, and 430 pixels.
- Arrival, claim, and Social fixtures: 19 passed, with one existing proof-only skip.

Fixture repairs follow current consent timing, static SVG drawing, public founding links, signed-out Social, price bands, and focus geometry.
The delayed composer fault did not reproduce with one worker.
Its retry change follows the recorded state: the picker closes before the composer loads.

### Latest broad browser run

The traced run against `1ad2e0a7a` stopped after 14.8 minutes.
It recorded 255 passed, 16 failed, two interrupted, two skipped, and 851 not run.
The [retained final summary](../../.lavish/product-audit/assets/full-traced-browser-summary.log) lists all failed and interrupted cases.
The full operational log remains at `/tmp/pubmaxx-audit-full-final.log`.
Root measured DOM calls taking five to eight seconds with tracing. Tracing added substantial overhead.
The next full run will omit tracing.

The 16 failures have mixed causes. Stale fixtures are corrected in `943bb4167`.
The older Layers lift fault may be removed by merged PR 1631, but a rerun must confirm this.
Other cases remain unproven. The failure count is not a count of confirmed product defects.
This interrupted run provides no full browser clearance.

### Earlier broad browser run

The initial full browser run used the unchanged starting build on ports 3410 and 3411.
It stopped after 33.2 minutes: 224 passed, 68 failed, one interrupted, two skipped, and 790 not run.
Later failures included host contention: load exceeded 90 on 18 logical CPUs, and navigation timed out before HTTP commit.
Those timeouts are not product-defect proof. The incomplete run provides no end-to-end clearance.

## Production data and deployment

Read-only queries used authoritative timestamp columns. They read timestamps only from Supabase project `iankajxliutqogqkmvdg`.

| Feed | Production timestamp, UTC | Age at check |
| --- | --- | --- |
| Weather, newest generated batch | 2026-09-07 18:00:29.456 | 2.55 hours |
| What's-On, oldest listing generation | 2026-09-07 05:30:14.289 | 15.06 hours |
| Night signal candidates, feed stamp | 2026-09-07 05:15:52.557 | 15.30 hours |

Weather and What's-On meet their 48-hour budgets. The candidate feed has no budget and was updated that day.
These are observations at the stated check time, not a live monitor.

<!-- AUDIT_UPDATE:production-version -->

The production API was rechecked and still reports commit `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
Deployment: `dpl_88fiZ7i4Cgdfrmu5u1wjnRYCnzYq`. Build time: `2026-09-07T21:27:03.621Z`.
The [production version record](../../.lavish/product-audit/assets/production-version.json) preserves those values and their source.
Coordinator map PR 1631 and native PR 1632 are merged and live in this release.
Earlier production findings remain attached to `74e688913` until each journey is repeated on the new release.
The Out/Tonight dead end was addressed by merged PR 1626. Its journey still needs release verification.
The audit branch has not been pushed or deployed.

## PUB-6 diagnostic scope

The redacted check covered seven groups and 19 occurrences from 31 August through 7 September in project `219466`.
The seven sampled responses had no stacks or release fields. The symbol-set lookup returned zero sets.
Current code already attaches a custom release. These samples identify no attributable current code defect.
Linear comment `dd22c8da-4745-46fe-8ea9-56081d0c9d5d` records the diagnosis. The issue state is unchanged.
The [diagnostic summary](../../.lavish/product-audit/assets/pub6-diagnostic-summary.json) retains counts and limits without personal metadata.

## Parallel work and native scope

<!-- AUDIT_UPDATE:social-integration -->

Social shared-identity fixes are integrated in `23e3a2073`. Independent review is clear.
The fix passes 70 focused tests and the owner's direct two-tab browser test.
These changes postdate the stable full gate. The earlier critical browser run used the integrated head. The fresh targeted run also includes that change.
Persisted draft content already survived reopening. The reproduced defect closed the composer during identity refresh.
Earlier Social feature commit `a400d383f` passed 16,459 tests, 373 PostgreSQL tests, and 20 browser checks in its owner's checkout.
Those counts remain owner-checkout history. They do not replace the aggregate gate for this freeze.
The audit now integrates that feature and gallery recovery through merge `5146c620a`.
Server correction `0b37eed4b` fixes original edit receipts, ready-upload cleanup, and hidden-gallery removal. Independent source rereview is clear.
The exact [SQL red](../../.lavish/product-audit/assets/social-server-sql-red.txt) and [SQL green](../../.lavish/product-audit/assets/social-server-sql-green.txt) logs are retained unchanged.
SQL checks pass 27 cases. The owner reports 48 store and route passes. Rollback checks compare exact function definitions and grants.
Commit `41d148962` prevents saved gallery drafts from returning after failed IndexedDB deletion.
Its fresh saved-post, failed-delete, reload browser case passes. Manual Clear-draft retry still fails separately.
The [review record](../../.lavish/product-audit/assets/pending-source-review.md) preserves closed findings and the current browser limit.
Migrations `0154` and `0155` remain captain-owned. Their production application is not verified in this audit.

<!-- AUDIT_UPDATE:native -->

The isolated callback checkout is `/private/tmp/pubmax-native-callback-fix`.
At `bd93c7292`, the [callback regression](../../.lavish/product-audit/assets/native-callback-red.log) reproduced four root-callback failures.
Commit `8522438` changes three files. Its [focused run](../../.lavish/product-audit/assets/native-callback-green.log) passes 83 tests across six files.
Independent source review is clear. That original commit remains in the separate native checkout.
The audit now contains callback reproduction `79d3095eb` and fix `d533a4a02`, with 83 focused tests passing.
Commit `815152f92` also removes the native first-run hard redirect and passes 71 focused tests.
These component tests do not prove an actual simulator or native device journey.
Coordinator PR 1632 is live, but it does not validate these later audit changes.
The audit's actual native acceptance remains open.
Fresh `81519fe99` browser checks reproduce 51.031% visibility of the primary onboarding action in both themes.
The corrected platform fixture reaches onboarding. At `f9a5d1677`, all primary actions pass the nine matched browser cases.
At `3e9f77ef5`, all nine cases pass, including both final-note checks at 320 pixels.
The nine-case candidate spec waits for the actual photo to decode before measuring initial geometry.
Its three seeded consent cases test isolated geometry. Seven corrected real entry contracts pass separately, as recorded above.

A later isolated native launch keeps the exact `bb56875a3bf6b92241ed000317eb72b1530aa547fe1f3966025811b2c3fab67f` app binary.
The served baseline is still `ad3af9599`; its version was checked before launch.
The app remains at [splash near 15 seconds](../../.lavish/product-audit/assets/ios-launch-0327-first.png) and [near 30 seconds](../../.lavish/product-audit/assets/ios-launch-0327-second.png).
A one-second sample stays in `dyld` at `__open`. The blocked file is unknown.
Safari also failed to appear within the bounded same-device check. Shutdown ended its pending launch; no independent Safari crash is claimed.
This establishes a simulator startup blocker. It does not establish an application defect or native acceptance.
The owned simulator and local server were stopped. Native entry, onboarding, and sign-in remain unverified.

A fresh disposable simulator provides a better control. [Safari opens its Start Page](../../.lavish/product-audit/assets/ios-fresh-safari-control.png).
The unchanged app binary still remains at its [launch screen](../../.lavish/product-audit/assets/ios-fresh-app-3e9-final.png).
This attempt serves the exact `3e9f77ef5` build on the binary's configured local port 3811.
The [process sample](../../.lavish/product-audit/assets/ios-fresh-app-3e9-sample.txt) again stops in `dyld` before application code.
Safari success narrows the control. It does not identify the app's startup cause.
The owned server and disposable device are removed. Native onboarding remains unverified.
Static framework and signing checks are under investigation before another instrumented launch.

Android venue Retry also passes with Capacitor 8.5.1 and Camera 8.2.4 on Android 16 and WebView 133.
The [updated proof](../proof/android-offline-retry/capacitor-851/README.md) uses source `41fa0274c` and APK SHA-256 `3222c422ce9b2252c8d55cc98b2e7052a834b8e1bfade73b8696c88bb7771763`.
Its 12 destination tests and one template test pass. The installed instrumentation result belongs to the earlier dependency build.
After offline Retry, the venue URL retained its exact query and fragment.
The earlier dependency build passed 12 focused JUnit tests, one template test, and one installed instrumentation case.
Original commit `a633144fbdf6992fc0c62ff50be5f4c91f32711e` is integrated as `ac40a445a` after two clear independent source reviews.
That earlier APK SHA-256 is `6b31a2bd1e30d483fabdf9275c3f18c6f0b5c4f037627fa667378f6037c42244`.
The area route was retained, but cached content loaded while offline. Repeated uncached failure remains unit-only proof.
The [Android proof report](../proof/android-offline-retry/README.md) and its native screenshots record normal-launch venue recovery.
The restored sheet still shows partial details. Destination recovery does not prove complete venue-data recovery.
A-to-B-to-outage-to-Retry remains untested.
The APK used the owner's existing dependencies. Its hash does not validate the later root dependency install.
This scoped Retry pass does not clear complete E2E journeys or native onboarding. Fresh isolated iOS proof remains pending.
Native sign-in, request-budget, and mobile reset-control checks remain with their owners.
Store signing, universal links, wider Android journeys, and physical-device checks remain release work.
Mobile browser dimensions do not count as native app evidence.

Root computer-use access works. Subagents have no exposed browser surface, so root supplies manual visual checks.
Mobbin connector search returned a paid-plan error. A separate coordinator accessed Mobbin through its authenticated browser.
That coordinator supplied the toast-placement reference. No further login or purchase is required by this audit.

## Documentation review scope

Performance review compared `fable52.md`, `fablenextsteps.md`, `docs/grok_prd.md`, and `FABLE_HANDOFF.md` with current source.
MapLibre 6.6, NightMode, Plan outbox, constraints, and desktop area search are implemented.
The July price baseline is obsolete. The reviewed price data now dates from 4 September.

Open milestones require a real group signup-to-recap flow, independent real contributions, seven days of event supply, and certified analytics/canary.
These milestones require field validation. They are not proven current code defects.

## Retained evidence

The portable report retains arrival, receipt, and controlled-failure screenshots, test logs, local fonts, and the actual PUBMAXX mark.
Its [provenance manifest](../../.lavish/product-audit/assets/provenance.json) records source paths and SHA-256 hashes.
These are local audit artifacts. Screenshot previews are explicitly labelled.
Generated venue data and unrelated test outputs remain outside these report changes.

Additional operational logs remain under `/tmp`:
`pubmaxx-audit-e2e.log`, `pubmaxx-audit-tonight-a11y.log`, `pubmaxx-launch-controls-fixed.log`,
`pubmaxx-guest-return-before.log`, `pubmaxx-guest-return-unit.log`, `pubmaxx-auth-fixtures.log`,
`pubmaxx-sw-consumption-before.log`, and `pubmaxx-sw-consumption-after.log`.

## Follow-up evidence at the a88c86d1f build

The two corrected map fixtures pass on the same production artifact: two cases in 41.6 seconds.
The tests cover venue-list updates, idle bearing, both themes, and repeated map-to-feed navigation.
The hydrated pub-gallery probe decodes five selected images on desktop DPR 2 and phone DPR 3.
Each profile loads 74,770 bytes across five HTTP 200 images, with no page errors.
The phone screenshot confirms a photo-overlay collision: 168-pixel art overruns its 140-pixel grid row. A separate correction is underway.
Computer use measures the Terms links at 5.53:1 in light mode, compared with 2.88:1 in production.
The Social clear-race fix passed independent root review and is integrated as `3a7b31e3c`.
Source freeze `ad3af9599` passed both builds and six gallery retests. Its complete browser result appears above.

## Reviewed corrections after the fourth gate attempt

The served application remains `3e9f77ef5`. Source `080394e3c` contains these later changes.

- `397a98399` consumes failed recipient-search response bodies before displaying the error. Thirty focused tests pass.
- `c976f0d48` evaluates retained tile failures after camera motion ends. Twenty-three actual-caller tests pass.
- `1dabf2ecd` includes owned Social posts and retained media in account exports.
- `56ca70069` reads upload reservations first and uses stable keyset pagination. Twenty-eight focused export tests pass.
- `080394e3c` tests the real phone alcohol-free drink control at 390 pixels. Browser validation remains pending.

Independent review cleared the exact export correction head and both controlled transfer regressions.
Real PostgREST embedding remains outside that source review. No production migration or account operation ran.
The map motion fix does not establish the cause of the separate settled-camera outage failure.
Fresh browser checks and the complete verification command remain required.

The integrated UI corrections follow the observed failures.
Desktop venue details now allow toolbar search while preserving the named dialog, entry focus, and Escape return.
Existing Drink-panel refinements are visible on desktop. Their beer and experience restrictions remain unchanged.
Mobile Search closes through the existing navigation owner, which removes the stale parent before another sheet opens.
The original strict venue spring and 44-pixel checks remain unchanged. Fresh browser proof is still required.

An instrumented iOS launch identifies the final camera-library path in [dyld output](../../.lavish/product-audit/assets/ios-dyld-0441-stderr.txt).
The loader selects the absolute host build copy before the embedded copy. Both files have identical bytes.
The unchanged binary remains at its [launch screen](../../.lavish/product-audit/assets/ios-dyld-0441-second.png).
Signature verification fails for both framework copies. The relationship between that failure and the stall is unproved.
The next controlled candidate will use normal simulator signing, with unchanged application source and dependencies.

## Retained outage evidence and signed iOS startup

Source `58b806eff` retains outage timestamps through silent map retries and schedules the existing bounded recovery decision.
Per-attempt tile keys and paint readiness still reset. Full verified readiness clears the retained evidence.
The [same-tests comparison](../../.lavish/product-audit/assets/map-settled-caller/settled-caller-current-tests-red.log) fails three cases against the unfixed product.
The [corrected caller run](../../.lavish/product-audit/assets/map-settled-caller/settled-caller-green.log) passes all 29 cases.
Scoped lint reports zero errors and one existing complexity warning. Fresh built-browser recovery remains required.

Normal Xcode simulator signing restores the actual iOS landing page.
The [signed startup comparison](../proof/ios-onboarding-actions/SIGNED-STARTUP.md) records exact source, binary, dependency and served-web identities.
All four ARM64 signature checks pass. The old unsigned artifact remains preserved.
Root viewed the [native landing capture](../../.lavish/product-audit/assets/ios-signed-startup/signed-build-settled.png).
This launch reused an owned simulator. It proves startup, without establishing fresh onboarding or account journeys.
The tracked simulator command still disables signing. Its smallest correction is under review.

## Fresh signed native entry

The native owner installs the retained signed binary on a new disposable iPhone 17 Pro with iOS 26.5.
The exact `3e9f77ef5` web build serves the app. No account, permission or marker changes occur.
The [fresh entry capture](../../.lavish/product-audit/assets/ios-signed-startup/fresh-signed-entry-second.png) shows the landing page and native tabs.
Root viewed this capture. Onboarding does not appear within the observed interval.
Independent source review still expects onboarding for eligible fresh native entry. The first routing decision remains unobserved.
A read-only Web Inspector plan is prepared. No native-detection or storage cause is asserted from the screenshot.
The owner reports stopping the server and removing only the new disposable device.
