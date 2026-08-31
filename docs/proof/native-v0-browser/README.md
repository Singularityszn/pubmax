# Native v0 browser-equivalent proof

Captured 27 August 2026 in the Codex in-app browser at a `390 x 844` CSS-pixel viewport.

## Scope

- Original capture branch: `codex/mobile-release-readiness`
- Original capture commit: `eb25c04cf`
- Current source-integration branch: `codex/mobile-release-current-main`
- Current source base: `65995519e62f341d232c451bcb250c19739ce1f2`
- Release-current status: stale. Recapture after wrapped builds run from one accepted commit.
- Shared web surface: `https://pubmaxxing.com`
- Deployed web commit: not exposed by the public surface, so these screenshots do not certify an exact deployed Git SHA
- Platform proxy target: iOS

These screenshots prove the shared mobile UI and the checked-in offline fallback in a browser-sized proxy. They do not prove a WKWebView, Android WebView, simulator, emulator, signed device, APNs, Google push delivery, universal links, Android App Links, store signing, or store review.

Codex browser did not allow the planned `Page.addScriptToEvaluateOnNewDocument` command or mutable page-world injection. Native-only branches could not be activated before application scripts. This evidence is therefore browser-equivalent UI proof, not native-runtime proof.

## Captures

| Surface | Theme | Source | File |
| --- | --- | --- | --- |
| Map | Light | `https://pubmaxxing.com/map` | `native-map-390-light.png` |
| Map | Dark | `https://pubmaxxing.com/map` | `native-map-390-dark.png` |
| Tonight | Light | `https://pubmaxxing.com/tonight` | `native-tonight-390-light.png` |
| Offline fallback | Light | `native/web-stub/offline.html` served from localhost | `native-offline-390-light.png` |

The light and dark Map captures use the product's visible theme control. The offline capture uses the exact checked-in native fallback without network data.

## Measured Map geometry

- Viewport: `390 x 844`
- Document client width: `390`
- Document scroll width: `390`
- Horizontal overflow: none
- Visible Map buttons: all at least `44px` high
- Primary controls measured at `44px`, `48px`, `52px`, or `56px`

## Remaining native proof

- iOS simulator debug launch with full Xcode
- Android emulator debug launch with JDK 21 and Android SDK tools
- Signed iOS device archive and App Store Connect validation
- Signed Android App Bundle and Play Console validation
- Push and deep-link checks on real enrolled devices

No signed build, store artifact, store submission, or production deployment was created during this proof.
