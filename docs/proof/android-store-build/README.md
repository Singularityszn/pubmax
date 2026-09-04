# Android emulator evidence

Captured on a booted Android 36 emulator (`sdk_gphone64_arm64`, Google APIs,
arm64-v8a) running the debug build of `com.pubmaxx.app` from this branch.

Rig, so the run is repeatable:

```
JAVA_HOME=<Temurin JDK 21>
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
avdmanager create avd -n pubmaxx_pixel -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7
emulator -avd pubmaxx_pixel -camera-back emulated -camera-front emulated -gpu swiftshader_indirect
npx cap sync android && (cd android && ./gradlew assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## `01-app-launch.png`

The shell loading production on a real device. It shows four things at once:
the branded launcher icon resolved, the splash handed over cleanly, the remote
origin (`https://pubmaxxing.com`) rendering inside the WebView, and the system
bars sitting outside the app's own content rather than over it.

## `02-venue-sheet.png`

The shell three taps in: onboarding taken, the map painted with real pins and
real prices, a pub sheet open on the Duke of St. Albans. It is also where the
in-emulator camera proof stops and the owner's device proof starts, and the
screenshot says why: logging a price needs an account, and an account needs a
magic link to an inbox. Section 8 step 12 owns that half.

## `02-permissions.txt`

`adb shell dumpsys package com.pubmaxx.app`, trimmed to the permission block.
This is the evidence that matters for the camera: `android.permission.CAMERA`
and `android.permission.READ_MEDIA_IMAGES` are on the INSTALLED binary, which
is what the operating system reads. Before this branch they were absent, and an
Android capture attempt was refused with nothing on screen saying why.

`READ_MEDIA_VISUAL_USER_SELECTED` is contributed by the Camera plugin's own
manifest and merges in on top; the app does not declare it.

## `03-app-links.txt`

The intent filters answering for themselves, through
`adb shell pm query-activities`. All eight route families in
`lib/nativeDeepLinks.ts` are claimed by the binary; `/tonight` and another host
are not, which is the two halves of that three-way agreement agreeing.

What this does NOT show is a VERIFIED App Link. Verification reads
`https://pubmaxxing.com/.well-known/assetlinks.json`, and the fingerprint in
that file is still the named placeholder because the signing certificate does
not exist until the Play account does. Section 8 step 13 turns it green.

## `04-bundle-release.txt`

Both `./gradlew bundleRelease` lanes: with no upload key, and with a throwaway
one. See the file for the sizes and the `jarsigner` result.

## `05-camera-permission.txt`

The camera permission moving from `granted=false` to `granted=true` on this
binary. This is the narrow thing the manifest change fixes: the OS now has a
runtime permission to grant. Before it, there was nothing to ask for.
