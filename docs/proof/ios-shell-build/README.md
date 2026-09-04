# iOS shell, first verified build

2026-09-04. Xcode 26.6, iOS 26.5 simulator runtime, iPhone 17 Pro, no
developer team set.

`simulator-scripted-run.png` is the same screen reached the same day from a
clean `npm ci`, through `npm run ios:build` and `npm run ios:run`
(`scripts/ios-simulator.mjs`) rather than by hand. It is what makes the check
repeatable: the scripts take `-project ios/App/App.xcodeproj`, because this is a
Swift Package Manager project with no `App.xcworkspace` and no Podfile, and they
run `npx cap sync ios` first, because `CapApp-SPM/Package.swift` names each
plugin by a relative path into `node_modules`.

`simulator-first-run.png` is the shell running: it has loaded
`https://pubmaxxing.com` in the WKWebView and landed on the native first-run
onboarding, which only the shell shows. That screen is the proof that
`isNativeApp()` answers true inside the WebView, so every seam gated on it is
live in the binary.

Two things also confirmed from the same build, neither of them visible in the
shot:

- `PrivacyInfo.xcprivacy` is copied into `App.app`, so the Resources phase
  entry took.
- The built app's entitlements are EMPTY. That is Xcode's team-less signing
  path, not a fault in `App.entitlements`, whose `CODE_SIGN_ENTITLEMENTS`
  setting still resolves. See STORE_READINESS section 8 step 9.

One defect the shot records rather than fixes: the analytics consent card
overlays the onboarding's own list, sitting across the Clapham row. Consent
outranks every other prompt on purpose (`analyticsChoiceHasPriority` in
`lib/promptBudget.ts`), so this is a placement question on a surface that
already owns its bottom edge with a fixed CTA, not a question of whether the
card should appear.

Not provable on a simulator, and therefore step 10 on a device: the camera
sheet, push delivery, and universal links. `xcrun simctl push` reports success
and shows nothing until notification permission has been granted inside the
app, and universal links need the real Team ID in the association file.
