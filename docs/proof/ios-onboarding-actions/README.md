# Onboarding actions on phones

## Current outcome: 8 September 2026

Do not integrate. Native behavior is blocked and the browser suite is not green.
The runtime slot has been released directly to Social. All owned runtime processes are stopped.
The shared simulator and its data remain unchanged.

One updated isolated native build succeeded with Next 16.3.4 dependencies available.
Capacitor iOS/core are 8.5.1. The camera plugin is 8.2.4, resolving IONCameraLib 2.0.0.
The native source checkout is `d55f6e16c0b4eceddb514bc9311e5de476c2b7bd` with freshly synced dependency manifests.
The built manifests and embedded configuration are preserved beside this report.
The embedded development server is `http://localhost:3811`.

Binary: `ios/build/Build/Products/Debug-iphonesimulator/App.app` in this isolated checkout.
SHA-256 values:

- App executable: `bb56875a3bf6b92241ed000317eb72b1530aa547fe1f3966025811b2c3fab67f`
- App.debug.dylib: `cdd4d1f622e10935c2a5eb66ad51fb9811bba2bc89bb7f65b59d24ef094dd985`
- Capacitor framework: `2bbc3565899e5d1544a3770c6d068e2a5d9f78b81cdf7d99b63bc57ca66c327a`

The fresh isolated simulator was `15BB7F4A-B86D-465B-B0D3-D2282924335E`, named `pubmaxx-ios-cta-baseline`.
It booted and installed the updated app without user data or seeded onboarding state.
Actual CUA captures show only the splash screen. No native request reached the development server.
A process sample shows dyld waiting in `__open` before application code, with a 480 KB footprint.
One app relaunch did not resolve this. A built-in Mobile Safari launch also hung for over 70 seconds.
That control supports a simulator runtime failure. It does not establish a web routing failure.
No security setting changed. The isolated simulator is now shut down.
Actual root entry, native CTA behavior, location denial, and final destination remain unverified.

The corrected browser double reproduced baseline clipping at 390x844: Plan my night had viewport ratio `0.5103124976158142`.
Initial screenshots are under `browser-baseline/`.
The candidate exposed a focus-induced 19-pixel scroll shift at 320x568.
Removing scroller-level scroll padding removed that shift. Companion controls now have focus scroll margins.
The final nine-case development browser run returned five passes and four failures:

- Both clean 430x932 theme cases passed, including keyboard focus and final content access.
- All three consent cases passed, including initial actions, dismissal, and Back.
- Three clean 320/390 cases reached both initial CTAs, then failed Back hit ownership against `nextjs-portal`.
- One clean 390 dark case remained on the root route. Its cause is not established by this run.

The diagnostic explicitly names the development overlay as the intercepted target.
No test bypass hides that overlay. No browser result is counted as native proof.
Current detailed failures and candidate screenshots are under `browser-diagnostic/`.

The sections below retain the preparation and earlier-window evidence for provenance.

Base: `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.

Proof baseline: `d55f6e16c`, after the routing owner's prerequisites.
These are `79d3095eb`, `d533a4a02`, and `815152f92`, applied in that order.
Local equivalents are `53860c1d0`, `31306ae0e`, and `d55f6e16c`.

## Problem

The clean first-run screen can place Use London below the viewport.
The existing sticky action rules require an analytics consent card.
Clean first run deliberately withholds that card.

Prior native reproduction: `../mobile-shells-refresh/README.md`, section Still open.
Its iPhone screenshot is `../mobile-shells-refresh/ios-iphone17pro/after-03-firstrun-clean-8831ms.png`.
This is prior evidence, not a new before capture.

## Prepared change

On phones, onboarding has a viewport-height scroll area.
The hero takes the space left after the controls, whether consent is present or absent.
The existing action row stays at its lower edge, with bottom safe-area padding.
The content remains scrollable. Desktop layout and onboarding actions remain unchanged.

## Checks

- `vitest run __tests__/nativeFirstRunConsentPlacement.test.ts --maxWorkers=1`: 8 tests passed.
- `eslint e2e/native-onboarding-actions.spec.ts`: passed.
- `git diff --check`: passed.

The new browser regression checks 320x568, 390x844, and 430x932 in both themes.
It checks zero initial scroll, full action visibility before clicking, hit ownership, and both stages.
It also checks keyboard focus, final content access, and consent presence and dismissal.
It uses a Capacitor detection double. It is browser coverage, not native proof.

## Runtime window: 7 September 2026

One development server ran on port 3811. It is now stopped.
The shared runtime slot passed directly to the Android owner.

The baseline Chromium test reached both stages through the root entry route.
At 390x844, Plan my night had viewport ratio `0.5103124976158142` at initial scroll zero.
The test failed before any action could scroll that button into view.
See `baseline-error.md` for the failed assertion.

The candidate run did not establish green. London was absent after the initial route transition.
See `candidate-entry-error.md`. A prior cold baseline run had the same entry failure.
Capacitor core replaces the simple browser double's detection methods when plugin code loads.
Its platform detector then sees no native bridge and reports web.
This is a supported explanation, not confirmed evidence of a native routing failure.
The scoped test now supplies Capacitor's custom-platform input to keep detection stable.
It still starts at `/`, issues no handoff, and uses the actual routing and eligibility code.
A lightweight Node import confirmed this mechanism with the installed dependency:
`simple double: ios -> web`; `custom-platform double: ios -> ios`.
The revised browser test has not run yet.

## Actual simulator observation

Device: iPhone 17 Pro, iOS 26.5.
Device ID: `BFDAFC8A-66A0-45EF-808D-96F12628885F`.
Installed app: `com.pubmaxx.app`.
Installed configuration: `server.url=http://localhost:3811`, `cleartext=true`.
This is development-origin evidence, not release-build proof.

`native-runtime-current.png` shows the existing Tonight page with a listings error.
The screenshot came from CUA Simulator controls.
No onboarding markers, account state, or simulator settings changed.
Safari Develop listed the App WebView, but CUA could not select its dynamic nested target.
Actual fresh entry and onboarding taps remain unverified.

Served `theme-init.js` matched the worktree file:
`07766dff536715dfcb2064495239ac666555fee67388f51eca995beb6fc35808` (SHA-256).
The routing owner's prerequisites are present, as listed above.

## Remaining proof before integration

- Run baseline and candidate with stable browser detection. Capture both initial stages before assertions.
- Check all viewport sizes, themes, consent states, keyboard focus, and final content access.
- Observe actual native root entry without seeding a handoff. Record any landing-page flash separately.
- Capture actual native before/after, both CTA stages, taps, consent dismissal, and safe-area clearance.

Do not integrate the candidate from browser-double success alone.

## Next native window

Use a new, isolated iPhone 17 Pro simulator with runtime `com.apple.CoreSimulator.SimRuntime.iOS-26-5`.
The device type is `com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro`.
Install the existing app bundle without copying its data container.
Its current path is:
`/Users/karanmanoharan/Library/Developer/CoreSimulator/Devices/BFDAFC8A-66A0-45EF-808D-96F12628885F/data/Containers/Bundle/Application/C29A0655-95E0-48A4-A010-ED72986E32B6/App.app`.

Do not clone the shared simulator or its storage.
Start the approved development server on 3811, then launch the isolated app at its configured root.
Capture baseline before any scrolling or CTA tap.
For candidate proof, use another fresh isolated install with the same binary and changed CSS.
Use CUA to inspect and tap the visible app.
Record root arrival, any marketing flash, London, companion, content access, and safe-area clearance.
Stop the test server and shut down only the isolated test device after proof.
No simulator creation, boot, or installation has started for this next window.

### Minimal execution order after root releases dependencies and runtime

1. Record web HEAD, candidate diff, installed Next version, app bundle hash, and embedded server URL.
2. Save candidate CSS outside the checkout. Serve baseline CSS from HEAD on port 3811.
3. Run the corrected 390x844 browser test with one worker, tracing off, and existing server reuse.
4. Preserve baseline initial screenshots and clipping failure before changing CSS.
5. Create a fresh iPhone 17 Pro simulator. Boot it and install the existing app bundle without its data.
6. Launch `com.pubmaxx.app` at its configured root. Observe entry with CUA, including any landing-page flash.
7. Capture London at initial scroll. Tap Use London, then capture the companion stage before further taps.
8. Stop only the isolated baseline app and simulator. Restore candidate CSS and let the server update.
9. Run all nine scoped browser cases with one worker. Keep initial screenshots and test results separate from native evidence.
10. Create a second fresh isolated simulator and install the same bundle. Repeat actual root entry and initial CTA checks.
11. Tap a companion, Back, Use London, then Plan my night. Verify the visible map planner destination.
12. If needed, dismiss the planner through its visible close control. Use the map's visible location control.
13. Deny the actual OS location prompt. Capture the refusal state and available manual area path.
14. Check consent only when the actual product offers it. Do not seed a handoff, city, or native consent answer.
15. Capture final native state. Record unobserved states explicitly instead of forcing them through test overrides.
16. Stop the development server and shut down only the isolated test devices. Report runtime release and exact evidence IDs.

Expected runtime: 15 to 20 minutes, including two fresh simulator boots and development route compilation.
No native compilation, package install, account creation, plan generation, or data submission is required.
If fresh entry fails, preserve the screen and logs, then report the blocker before repeating device work.

## Static handoff after runtime release

The Back interception identifies `nextjs-portal`, not a product control.
The next check must use a production-serving build, without hiding overlays or forcing clicks.
No further product spacing change is justified by that development-overlay failure.

The remaining entry failure is unresolved.
The default browser fixture seeds consent and map-arrival choices only, not city or native entry markers.
The gate stores its decision in a ref, preventing repeated effect setup from consuming the handoff twice.
A root remount after the entry stamp could read session-revisit and clear the issued handoff.
Development reload or remount is therefore a hypothesis, not a confirmed cause.

Minimal next window: build the candidate once in an isolated production output directory, then use `next start` on 3811.
Reuse an existing artifact only if its exact source and candidate CSS match.
Run all nine scoped cases with one worker, tracing off, and no routing or overlay bypass.
On failure, record navigation paths, response status, RSC headers, platform detection, and known entry-marker presence.
Do not record account tokens or unrelated storage.
Keep the existing development baseline red explicitly labelled by serving mode.
If production entry still fails, preserve that failure before proposing any route change.
Expected cost is one production build plus two to three minutes of browser checks, provisionally eight to twelve minutes.
Actual native acceptance remains a separate requirement.

## Independent fixture review

The initial custom-platform fixture still defined `window.Capacitor` as read-only.
Capacitor 8.5.1 assigns its initialized bridge back to that property.
A direct import of the installed SDK reproduced `TypeError: Cannot assign to read only property 'Capacitor'`.
The corrected fixture adds `writable: true`.
A second isolated Node process imported the same SDK successfully and verified its global assignment, iOS detection, and plugin registration method.
This proves the fixture defect and correction, not the cause of a particular recorded browser failure.
No browser or native runtime was started for this check.
The next production-serving browser run must use this corrected fixture.

## Same-device reboot control

At 23:39 UTC on 7 September, the same isolated simulator booted successfully in ten seconds.
Built-in Safari launched successfully as process 60538.
CUA showed its actual Start Page and saved `native-reboot-safari-started.png`.
This demonstrates recovery of the simulator's Safari control after reboot.
It does not validate PUBMAXX or prove the earlier startup cause.
No app build, development server, new simulator, data clone, or security change occurred.
The owned simulator was shut down again and runtime released directly to receipt.
