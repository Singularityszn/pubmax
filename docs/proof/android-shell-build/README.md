# Android shell, first verified build

2026-09-04. JDK 21, Android Gradle Plugin 8.13.0, Gradle 8.14.3, `compileSdk`
and `targetSdk` 36, on Apple silicon. No upload key, no Firebase project, no
Play account.

`emulator-scripted-run.png` is the first screen of the shell, reached from a
clean `npm ci` through `npm run android:build` and `npm run android:run`
(`scripts/android/`) rather than by hand, on a headless API 36 `google_apis`
arm64 emulator under `swiftshader_indirect`.

The Android project needed no changes: `./gradlew assembleDebug --no-daemon`
reported `BUILD SUCCESSFUL` on the first run, and the 10 MB debug APK installed
and launched.

The shot is the live site, not a bundled page. This is a remote-URL wrap, so
what the WebView holds is `https://pubmaxxing.com` itself: the shot shows
`/tonight` with the day's own date, the weather line and the phone tab bar.
`native/web-stub/offline.html` is what would appear instead if the main frame
could not reach production.

Two things the same run confirmed, neither visible in the shot:

- Both optional lanes announce themselves and still build. `keystore.properties`
  is absent, so a release build would be unsigned, and
  `android/app/google-services.json` is absent, so push will not register. Both
  print at Gradle's lifecycle level, which is the point of them.
- All four Capacitor plugins are in the binary: `@capacitor/app`,
  `@capacitor/camera`, `@capacitor/haptics` and `@capacitor/push-notifications`.

One thing the emulator taught the scripts rather than the app. A screenshot
taken on a timer can show something that is not the app, twice over: SystemUI
under software rendering is slow enough to hit its own ANR, and that dialog
takes the focused window over a perfectly healthy app; and even once our
activity holds the window, SystemUI has not finished applying the status-bar
icon appearance, so a shot ten seconds after focus showed white status-bar
icons over the light page and read as a contrast bug. Measured on the same
device with nothing touched, they painted at #646464 on #FAFAFA a minute later.
`scripts/android/run.mjs` waits for both, and the constants carry the reason.

Not provable on an emulator, and therefore device steps in STORE_READINESS
section 8: push delivery (it needs the real `google-services.json`), App Links
verification (it needs the Play app-signing SHA-256 in
`public/.well-known/assetlinks.json`), and the camera sheet.
