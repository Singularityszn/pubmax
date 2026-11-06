# Next iOS acceptance window

Preparation only. No runtime is authorized by this checklist.
Source acceptance reference: `/tmp/pubmaxx-open-issue-acceptance.md`, read 8 September 2026.
Use the final approved artifact, not an earlier source name from that snapshot.

## Required state

- Preserve owned simulator `15BB7F4A-B86D-465B-B0D3-D2282924335E` and all current data.
- Record installed binary hashes, embedded origin, served source/build ID, dependency versions, device size, theme, and text size.
- Reuse the existing updated binary. Do not build or install during preparation.
- Onboarding needs genuinely unused first-run state. Prior app attempts reached no web request, but verify this before counting fresh entry.
- Do not seed handoff, preferred city, or consent to force native onboarding.
- Signed-out checks need no account. Wait for the auth provider's actual signed-out answer.
- Retain location permission as not determined until its denial test. Do not change global simulator privacy settings.
- Active-plan and awake-switch checks require an approved disposable existing plan with the matching member state on this isolated device.
- Social invite checks require an approved existing adult test account and crew, or remain explicitly unverified.
- Do not create accounts, submit plans, seed actor tokens, or use the shared simulator to manufacture missing state.
- Sheet/collision checks require accepted integration of the existing map-owner patch. Verify its commit is in the served artifact.

## Bounded order

1. Confirm simulator boot and visible app startup. Safari recovery and compilation count only as tooling evidence.
2. Run #1531 first, before any city choice. Capture initial London after the photograph visibly decodes and layout settles.
3. If consent is naturally offered, capture it, dismiss it, and capture the full CTA again without scrolling first.
4. If consent is absent, record that absence. Browser consent fixtures do not prove native dismissal behavior.
5. Tap Use London, inspect the companion CTA, select a companion, test Back, and return through Plan my night.
6. Verify the actual map planner destination. Close the planner through its visible control, request location, and deny the OS prompt.
7. Capture the refusal and manual area path. Make no account or plan submission.
8. In light theme, inspect Today, Out, and Tonight for #1542. Capture system status-bar bounds and navigation top offsets.
9. Capture Now and You selected for #1544, with the whole pill and home-indicator region visible.
10. Open Social, select Posts through its visible tab, and capture resolved signed-out content and next action for #1541.
11. Inspect selected venue `venue-1r4e6my` for #1543. Include decoded map labels and actual status-bar bounds in the capture.
12. Repeat steps 8 through 11 in dark theme on the same device and source.
13. Only after map-fix integration, inspect venue booking and Plan Max sheet floors for #1533. Scroll each to its last row.
14. Test the four #1536 states separately: active-plan pill, map Retry, Keep screen awake, and Social invite.
15. Record missing fixture states as unverified. Do not infer the other collisions from a passing Social invite.
16. Shut down only the owned simulator, stop owned servers, and release runtime to the assigned next owner.

## Cold-route constraint

The installed binary starts at its embedded root URL.
The inspected deep-link seam accepts production-origin `/map` and `/tonight`, but not `/today` or `/out`.
The unsigned simulator build does not prove universal-link entitlement delivery.
A normal tab tap is warm navigation and cannot satisfy a cold-launch criterion.
Use an owner-approved native route-entry method for cold-route cases.
A Web Inspector hard document reload may prove cold document layout, but must not be labelled an OS cold launch.
If exact native cold-route entry cannot be established, report that gap rather than silently substituting Safari.

## Evidence and timing

Save per-issue screenshots with theme, route, artifact, and navigation type in the evidence record.
Where WKWebView inspection is available, read geometry and image decode state without changing page or storage state.
Otherwise report visible image readiness and screenshot bounds without inventing DOM measurements.
No viewport-only capture counts as native evidence. No Safari control validates PUBMAXX.

Allow 15 to 20 minutes for the unsigned-out/native geometry sequence after artifacts are ready.
Allow another five to ten minutes only if the approved plan/account fixtures and map patch are ready.
Production browser validation of the corrected writable nine-case fixture remains a separate two-to-three-minute run, excluding build time.
