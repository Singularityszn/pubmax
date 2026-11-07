# The native shell (Android)

The Android half of every native promise: the manifest, Gradle, the notification icon and the emulator rig. The shared shell seams are in [ios/AGENTS.md](../ios/AGENTS.md). Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **The Android half of a promise is a different file, and it fails without a sign.** A camera needs `CAMERA` in `android/app/src/main/AndroidManifest.xml`, with the hardware feature marked not required. App Links need `public/.well-known/assetlinks.json`. `__tests__/nativeWrap.test.ts` holds each iOS and Android pair together.
- **The notification icon is three files.** `android/app/src/main/res/drawable/ic_stat_pubmaxx.xml`, the two `default_notification_*` meta-data lines in the manifest, and `android/app/src/main/res/values/colors.xml`. `__tests__/androidNotificationIcon.test.ts` holds them together.
- **The splash has one master.** `public/store-assets/splash.svg` serves light and dark. `scripts/gen-native-app-icons.mjs` reads it for both platforms.
- **`npx @capacitor/assets@3 generate` writes more than icons.** Revert its changes to `public/manifest.webmanifest` and the Android manifest after every run.
- **No key reaches the repository.** The Firebase config and the keystore files are gitignored. `android/app/google-services.json.example` is the committed placeholder. A skipped Firebase or signing lane prints at Gradle lifecycle level.
- **R8 stays off.** Capacitor finds plugins by class name, and a shrinker removes them.
- **Build with `npm run android:build` and `npm run android:run`.** `scripts/android/toolchain.mjs` resolves `JAVA_HOME` and `ANDROID_HOME`. Run `npx cap sync android` after a plugin lands.
- **An emulator screenshot is evidence only after it settles.** Wait until the window manager names our activity and the status bar finishes.
- **Never write `--` inside an Android XML comment.** The resource merge refuses it and the whole build fails.
- **A local rig loads a local build.** Set `PUBMAX_NATIVE_SERVER_URL` at `npx cap sync` time. Unset, the shell loads production.

## Detail

Full rules, pins and history: [`docs/rules/android-manifest-gradle-and-assets.md`](../docs/rules/android-manifest-gradle-and-assets.md). Toolchain and checklist: `docs/STORE_READINESS.md` section 8.
