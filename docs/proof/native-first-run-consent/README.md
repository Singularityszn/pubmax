# Native first run, consent card placement

2026-09-04. Xcode 26.6, iOS 26.5 simulator runtime, iPhone 17 Pro, the same rig
as `docs/proof/ios-shell-build`.

The analytics consent card outranks every other prompt
(`analyticsChoiceHasPriority`, `lib/promptBudget.ts`), so on a first launch it
is on screen over the onboarding surface. That priority is right. Where the
card SAT was not.

## Before

`first-run-before-iphone17pro.png` is the shipped shell against
`https://pubmaxxing.com`. The card lies across the reviewed-area list: Clapham
keeps its name but loses its "Home via Clapham Common" line, and Victoria is
covered outright. The "Use London" button is under it too.

Two things put it there. `.firstRunStage` is sized to the viewport, so its last
rows land exactly where a fixed bottom card does, and the foot padding
`app/globals.css` reserves on an ordinary page cannot lift a block that is
explicitly viewport-height. Separately, the surface hides the tab bar with
`display: none` rather than removing it, so the card's tab-bar berth held it
72px up over a bar nobody could see.

## After

`first-run-after-iphone17pro.png` is the same build pointed at a local server
carrying this branch. The card is on the safe area at the true bottom, and the
surface ends above it: Clapham reads in full, and the card covers nothing at
any scroll position, because the surface is its own scroller and the card sits
outside it.

## Reproducing

`server.url` in `capacitor.config.ts` was pointed at a local `next dev`, and
`NSAllowsLocalNetworking` was added to `Info.plist` so the WKWebView would load
cleartext localhost. Both edits are local to the capture and are NOT in this
branch: `__tests__/nativeWrap.test.ts` fails on the first, and it is the fence
that caught the temporary state before it could be committed.

Uninstall the app between runs. Installing over an existing container keeps its
web storage, and the first-run redirect is one-shot per device
(`lib/nativeFirstRun.ts`), so a reinstall alone lands on Tonight instead.

The arithmetic behind both shots is held by
`__tests__/nativeFirstRunConsentPlacement.test.ts`, which resolves the shipped
lengths for four phone viewports and asserts the two bands never share a
bounding box.
