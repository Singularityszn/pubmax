# Mobile app design review, iOS and Android shells

Started 7 September 2026. Every finding names the rig it came from.

| Rig | What it is | Folder |
| --- | --- | --- |
| `ios-sim-iphone17pro` | iPhone 17 Pro simulator, iOS 26.5, Xcode 26.6, Capacitor 8.5 shell, no signing team | `ios-sim-iphone17pro/` |
| `android-emu-pixel7` | Pixel 7 AVD (`pubmaxx`), API 36 `google_apis` arm64, gesture navigation, headless under `swiftshader_indirect` | `android-emu-pixel7/` |

Both shells were synced against a local keyless production build of the branch
under review (`docs/CAPACITOR_WRAP.md`, "Reviewing a local build in the shells"),
so the pages inside the WebView are the checkout rather than production. Where a
shot was taken against production instead, its README says so.

Store readiness at the end of the loop: `STORE_READINESS.md` in this folder.
