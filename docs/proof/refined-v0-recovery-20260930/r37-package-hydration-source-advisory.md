# R37 package hydration source advisory

SOURCE/EXISTING-LOG REVIEW ONLY. No browser, server, test, build, install, SQL, secrets, Git mutation or package-lane edit. Only this Core receipt written. Core's private-link regressions and both source lanes preserved. Package owner retains runtime, manifest and diagnosis ownership.

Compared package candidate `5e89393f8` against its Main base `f33f77e42`, and relevant current Core source in `/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx`. Main-to-Core differences include unmerged Core work; they are not automatically upstream removals. Applicable app/components/e2e area ownership retained.

## Actual failure and later existing receipt

`/Users/karanmanoharan/.local/state/pubmaxx-gnhf-20260930/package-refresh/core-browser-smoke.log` records Next 16.3.8 production start on port 55401, Chromium one worker/retries zero: six routes passed, Moment and Social failed the unchanged page-error assertion at `e2e/core-route-smoke.spec.ts:53`. Each captured one `Minified React error #418` with `args[]=HTML`; both ready-marker/status assertions had already succeeded. These are real hydration errors, not HTTP or missing-scaffold failures. Installed Next React implementation names this path `throwOnHydrationMismatch` (`node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js:2932`). No component mismatch stack or differing HTML subtree is present in the bounded log; the referenced test-results error-context files were absent at their reported package paths when inspected.

A later existing log, `core-browser-matched-env.log` in that same receipt directory, records build followed by start through Playwright, Next 16.3.8, all eight tests passing, including Moment 170ms/Social 184ms, total 27.0s. This is an additional real outcome, not an execution by this reviewer. Exact matched build/start environment and artifact identity belong to the package owner's manifest; the filename alone does not prove the cause of the earlier errors. Preserve the original RED.

## Narrow source/version comparison

- Candidate-to-Main changes include package/lock/helper dependencies, Next config, TypeScript config and one unrelated plan test daypart. They contain **no Moment/Social/auth/media/nav route component edits**. Moment page/Capture, Social page/client, viewer-session hook and social launch provider are unchanged between candidate and Main.
- Main and Core lock Next at 16.3.7; candidate lock is 16.3.8. All three lock `react` and `react-dom` at 19.3.0 with the same respective integrity strings. Therefore this is not a root React version upgrade. Next's bundled runtime/build output can still differ; no causal Next regression follows from the version change alone.
- Candidate additionally updates Clerk, PostHog, Lucide and other packages; browser overrides change Playwright/playwright-core 1.62.1 to 1.63.0. `next.config.mjs` adds `experimental.useTypeScriptCli:false`; `tsconfig` adds Node types. The successful build/type gates do not settle browser hydration, but no direct app-render change was found in this candidate range.
- Core's Moment/Social files and shared `useViewerSession`/social launch hook are also identical to Main in the bounded comparison. Core differs in AuthProvider bootstrap/callback/logout race handling, AccountOnboarding presentation ownership, root CSS aggregation, and MobileTabBar's pure leaf import. Those differences prevent treating Core's earlier full-five/screenshots as a controlled baseline for this package candidate. R35's reported failure set or later screenshots do not independently prove the current two routes hydration-clean under candidate environment.

## Concrete shared markup seam, hypothesis only

Both failed routes branch first-render markup on the same provider phase:

- Package `components/auth/AuthProvider.tsx:306-319` calls `isAuthConfigured` and combines configured/provider state into `providerAuthState`. `components/auth/useViewerSession.ts` converts that authority to unresolved versus signed-out.
- `components/moment/MomentCapture.tsx:743-757` renders no sign-in block while unresolved, but renders a sign-in block when signed out. Draft restoration is in an effect (`:181`); the media viewport uses an explicit false server snapshot (`:159-163`). These source guards do not establish a random/time/media mismatch.
- `app/social/SocialPageClient.tsx:842-860` renders different unresolved loading versus signed-out boundary markup. Its server-derived initial query/launch prop and the root social launch context do not show a candidate-specific source change.

Playwright config makes a build/start environment mismatch concrete enough to investigate: `playwright.config.ts:395-419` either starts an existing artifact under screenshot mode or builds and starts under the same declared webServer environment, including public Supabase fixture configuration. The original log contains start only; the later passing log contains build then start. Next's installed environment guide (`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`, Bundling Environment Variables for the Browser) states public variables are inlined at build time. `node_modules/next/dist/lib/static-env.js:42-56` enumerates public variables present in the build environment.

If an artifact built without the fixture's public auth configuration is later started with that configuration, server and browser can disagree about configured/unresolved versus signed-out, exactly the markup fork shared by these two routes. This is a **source-supported hypothesis**. No original compiled auth values, SSR/client subtree comparison or original configuration manifest was inspected; do not call it proved environment error or waive #418. Do not disable the error assertion, add hydration suppression, delay auth, or roll dependencies back merely for a green result.

## Smallest next owner action

First reconcile the two existing log receipts with package owner's source/build manifest: candidate SHA, build directory/BUILD_ID, Node and browser versions, test flags, and whether the relevant public configuration was present consistently at build and start. Record configuration names/presence only, never secrets. If the later log proves a fresh candidate artifact under declared config, it is current eight-route PASS at that level; original standalone-artifact mismatch still needs classification.

If attribution remains necessary, build Main `f33f77e42` in an owner-approved isolated baseline with its lock and the **same declared build/start configuration**, then drive both servers serially with the same installed package-candidate Playwright/browser and unchanged eight-route spec (`--project=chromium --workers=1 --retries=0`). Candidate's existing test and fixture bytes are unchanged from Main. This controls browser version while retaining original application source/dependency differences; do not install or replace a live owner's dependencies to obtain it.

For declared-config candidate verification, the existing direct command is `npm run test:e2e -- e2e/core-route-smoke.spec.ts --project=chromium --workers=1 --retries=0` with an owned private PW_PORT/PW_NEXT_DIST_DIR and ordinary config build path, not screenshot/start-only mode. For a separately built baseline server carrying those same config values, candidate driver may use the existing `PW_SKIP_WEBSERVER=1` path and its owned PW_PORT. Free ports/lease and tracing/output ownership remain the package owner's responsibility.

If fresh Main and candidate differ, capture only these two routes' native hydration errors and SSR/first-client branch evidence before isolating a dependency. If both pass with matched configuration, distinguish a malformed reused artifact from a product defect using the original artifact/config evidence. This advisory supplies neither causal closure nor final Core verification.
