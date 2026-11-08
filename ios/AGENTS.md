# The native shell (iOS, and the seams both platforms share)

The Capacitor wrap: the seams gated on `isNativeApp()`, the iOS capabilities and the store review. The Android half is [android/AGENTS.md](../android/AGENTS.md). State every capability on both platforms. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **The shell is the site plus a few seams.** Each seam is gated on `isNativeApp()`. `lib/nativePlatform.ts` is the only Capacitor probe. `lib/nativeCamera.ts` is the only photo seam.
- **A Capacitor plugin is a Proxy.** Never `return` a plugin from an `async` loader: the `await` calls `plugin.then()` on the native side and fails. Return a plain object that closes over the plugin. `__tests__/capacitorPluginProxy.test.ts` checks every loader.
- **iOS capabilities are files.** `ios/App/App/App.entitlements` is the one entitlements file. Do not add a capability by hand in Xcode, because that writes a second file. `ios/App/App/PrivacyInfo.xcprivacy` moves with `docs/STORE_READINESS.md`.
- **Build with `npm run ios:build` and `npm run ios:run`.** The project uses Swift Package Manager: no Podfile and no workspace. Run `npx cap sync ios` after a plugin change. A green simulator build does not prove the entitlements.
- **The store review is asked once ever.** `lib/nativeReviewPrompt.ts` owns the timing. Write the marker before the plugin call. The OS dialog is the whole UI: no stars and no request for a good rating.
- **Share through `lib/nativeShare.ts`.** The Android WebView has no `navigator.share`. A dismissed sheet is a cancel, never a fallback.
- **iPhone sign-in returns.** Email links: [`docs/rules/ios-native-email-return.md`](../docs/rules/ios-native-email-return.md). Third-party sign-in: [`docs/rules/ios-native-auth-return.md`](../docs/rules/ios-native-auth-return.md).
- **A client error report is redacted and stored nowhere.** `lib/clientErrorReport.ts` defines redaction. The route writes one log line and never grows into analytics.
- **Store screenshots come from production.** `npm run gen:store-screenshots` refuses a dev server.

## Detail

Full rules, pins and history: [`docs/rules/ios-shell-seams-and-capabilities.md`](../docs/rules/ios-shell-seams-and-capabilities.md). Runbooks: `docs/STORE_READINESS.md` and `docs/CAPACITOR_WRAP.md`.
