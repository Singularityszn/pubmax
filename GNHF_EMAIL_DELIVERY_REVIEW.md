# Email delivery readiness review

This corrected review is complete as a bounded document. The email repair, release, and original-account physical Mail acceptance remain pending. This iteration changes only this file. It performs no source repair, operational action, or new broad research.

The read-only inputs are `gnhf-recovered-draft.md`, `final-source-binding-preparation.md`, and `final-source-integration-checkpoint.md`. They are under `/Users/karanmanoharan/.codex/worktrees/ios-email-return-1013/pubmaxx/artifacts/native-email-return/`. The recovered assessment established no additional reachable source defect. This review preserves its requirements and corrects its signing deadline, authorization, and source attribution.

## Source and admission

The source review remains frozen at `b69dc0d8950f6d8258f562b50bd9dfa016549ec5` (b69). Its prior 32 suites and 572 tests belong to b69 and their recorded Node/npm versions.

Root ordinary-merged recorded `origin/main` `599252af3019f3776b5d78d297fae2d871fbd87f` into its owned candidate. The result is `b61d62fa7163f77284cffcc8915cb538e68af5a3` (b61). The checkpoint records a clean merge, no changed-file overlap, and no native-email declaration changes. No tests ran on b61. Declaration equality and compatibility review cannot transfer the b69 test result to b61. Owners must check the frozen conclusions against the admitted candidate before use.

Supervisor reply 090 binds NEXT to b61 after actual launch full-family release. NEXT is a queue assignment. No heavy admission occurred. Writer599 and its single original frontend remain preserved. Native/Caller and F26 custody remain unchanged. This document does not request recovery, allocate capacity, or authorize competing work.

## Essential source trace

These references describe the reviewed path. They are source evidence, not installed-device or hosted evidence.

| Reference | What it supports |
| --- | --- |
| `components/auth/AuthProvider.tsx`, `lib/nativeEmailAuth.ts` | Native email initiation, callback handling, and session resolution require their dedicated transport. |
| `lib/nativeEmailPkce.ts:6,41`, `AuthProvider.tsx:904-923` | The native receipt has a one-hour lifetime. Cancellation and expiry must prevent session restoration. |
| `lib/nativeEmailLinks.ts`, `app/auth/callback/route.ts` | The HTTPS callback and native email relay form part of the delivered link path. |
| `lib/nativeDeepLinks.ts`, `components/native/NativeDeepLinks.tsx` | The generic router defers email mode to its dedicated consumer. |
| `ios/App/App/SceneDelegate.swift`, `NativeAuthCallback.swift` | Native URL forwarding and callback declarations need compiled and installed proof. |
| `ShellBridgeViewController.swift`, `NativeAuthSessionPlugin.swift`, `app/api/auth/session/route.ts` | Native provider registration and session installation need runtime proof. |
| `AuthProvider.tsx:1282-1320` | Product sign-out removes the resume cookie and remembered entry, and can select another remembered account. |
| `capacitor.config.ts`, `Info.plist`, `App.entitlements` | Declared origin, bundle, scheme, and capabilities do not identify the installed executable. |

The required physical chain is Mail, browser, GoTrue, HTTPS relay, and the original app. Callback injection omits email delivery. Browser sign-in alone omits native session installation. A public profile or cached handle cannot establish the original canonical account or its owner controls.

## Canonical origin and conditional development route

The host independently checked the canonical production-origin constraint. Production builds redirect email initiation to the live canonical site. The documented local production-shell recipe therefore cannot establish an owned pre-live native request against a separate origin. A preview URL alone cannot overcome that constraint.

A development Mail route remains conditional on an admitted development rig, development-mode origin behavior, and a reachable hosted HTTPS callback. Owners must bind that route to the intended Auth project, redirect allowlist, and actual MagicLink/ConfirmSignup behavior. The installed app must load the intended document and receive the custom callback. This review establishes none of those hosted or runtime facts.

If the original acceptance requires phone proof before publication, hold at the development-rig and hosted-callback prerequisite. Do not rename a live-first test as pre-release proof. If the development route is unavailable, its acceptance stays pending. Any authorized production release remains subject to the original sequencing requirements.

## Signing and preservation

The refreshed preparation records one matching local development profile for `com.karanmanoharan.pubmaxx.demo`. Only that profile expires at **2026-10-14 04:58:27 UTC**. The matching certificate remains valid until **2027-10-07 04:44:01 UTC**. The profile is the immediate deadline. A new binary signed with it inherits its expiry. Late admission requires supported owner reprovisioning with the same bundle and team.

The profile permits one device and development debugging. It lacks push and Associated Domains entitlements. Its device count does not prove membership for the selected phone. Local signing metadata does not prove the installed binary's validity, source, TeamID, or entitlements.

Installed metadata names demo version 1.0/build 1. Candidate production declarations name `com.pubmaxx.app`. A necessary in-place demo update needs local signing/build overrides for the existing bundle and team. A task-local Debug entitlement override must accommodate the free profile. Production declarations remain intact. The custom relay does not require Associated Domains. This route proves no push, universal-link, or Password AutoFill capability.

Human authorization already covers original-account physical email testing, preservation of the installed demo bundle/data, a necessary in-place signed update, and deployment of the verified fix. Generic permission is not missing. Actual phone, operator, mailbox, or identity inputs can still prevent testing. A concrete preservation boundary can also hold an unsafe state transition.

Product sign-out can remove remembered entries and select another account. That source-backed hazard requires an agreed state transition within existing authorization. It does not justify account replacement, clearing storage, or resetting the app. If preservation cannot be established, leave the affected case pending.

The admitted build receipt must bind the final Git head, native declarations, generated Capacitor configuration, bundle/build identity, executable digest, and signing compatibility. The generated configuration is absent from the clean candidate. Compiled App plugin availability, installed WebView origin, and remote web-source identity remain unproved.

## Main-only release and hosted gates

Publication remains pipeline-only. The source and pipeline owners complete final-candidate validation and review under `docs/agents/build-methodology.md:58-65`. The captain decides the merge. The release owner uses a clean checkout of the current merged main tip.

`npm run release:prod` fetches main and refuses `HEAD != origin/main`, at `scripts/lib/releaseProduction.mjs:67-80`. A reviewed branch SHA alone is not releasable. The command does not run `verify` itself. `docs/DEPLOYMENT.md:375-394` records the supported command and required permissions.

The migration preflight precedes upload, at `scripts/release-production.mjs:59-70`. It needs an existing `SUPABASE_ACCESS_TOKEN` and the intended `SUPABASE_PROJECT_REF`. `scripts/lib/migrationLedger.mjs:42-76,79-97` accepts full migration names or bare slugs. Missing repository migrations refuse release. Remote-only entries are reported. Missing credentials or ledger failure remains a gate. The captain owns migration actions.

The host independently checked the release helper's arguments. It invokes `scripts/deploy-vercel.mjs` without `--prod` or production-value forwarding. That script stamps the commit and forwards its arguments, at lines 96-106. This is a concrete deployment-value gate. Owners must establish the actual artifact's Auth project and public configuration through the supported release path. Promotion cannot prove correct Auth values. A separately prepared preview cannot establish the values of the artifact that this command promotes. This gate grants no permission to bypass the command.

The helper deploys, promotes, waits for the live deployment ID, and dispatches smoke for the released SHA (`releaseProduction.mjs:88-158`). The receipt must match SHA, deployment URL/ID, dispatch time, and smoke head. `/api/version` exposes the deployment ID publicly and adds commit/build time with authentication (`app/api/version/route.ts:31-51`). GET success cannot prove Mail delivery or account identity.

The signed-in production smoke lane uses its dedicated account and controlled writes (`e2e/prod-smoke/README.md:9-36`, `.github/workflows/prod-smoke.yml:93-114`). It cannot accept the original Mail path. Missing smoke credentials or production movement invalidates acceptance. Failure after promotion leaves a live, unverified deployment for its owner to resolve.

## Original-account physical acceptance

All cases remain pending against the admitted signed app and bound hosted source. Keep private identifiers, callback codes, links, verifiers, and tokens outside committed evidence.

1. Record the original phone, available operator, mailbox access, canonical identity, and account-bound handle. Check installed signing and loaded origin.
2. Establish a settled signed-out state within the preservation boundary. Stop if another account resolves or the transition removes protected state.
3. Request a fresh link and cancel through the app before opening Mail. Check that no session or owner navigation appears.
4. Request a separate link for expiry. Wait beyond the one-hour receipt lifetime and recorded hosted expiry. Record real elapsed time. Keep the clock and storage unchanged.
5. Request a fresh warm link and background the app. Open Mail and follow the actual verification link and return prompt.
6. Check the original canonical identity, handle, You profile, and owner controls. Reopen the consumed message and check replay protection. Relaunch and check restoration.
7. Establish another permitted signed-out state. Request a fresh cold link and terminate the process before opening Mail. Check callback launch, bootstrap, verifier recovery, identity, replay, and relaunch.
8. Record any existing-session restoration guard separately. It cannot substitute for signed-out cold completion.
9. Exercise welcome-back only if the original expired-session state exists. Do not manufacture cookies or clear storage. Otherwise leave that physical case pending.

Offline fixtures, a backgrounded warm return, and component remounts cannot replace these cases. F26 capture and VoiceOver remain deferred with their owner. The immutable original plan stays unchanged. Admission, integrated proof, signing/source binding, hosted values, release gates, and every original-account Mail case must close before delivery acceptance.
