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

## `02-permissions.txt`

`adb shell dumpsys package com.pubmaxx.app`, trimmed to the permission block.
This is the evidence that matters for the camera: `android.permission.CAMERA`
and `android.permission.READ_MEDIA_IMAGES` are on the INSTALLED binary, which
is what the operating system reads. Before this branch they were absent, and an
Android capture attempt was refused with nothing on screen saying why.

`READ_MEDIA_VISUAL_USER_SELECTED` is contributed by the Camera plugin's own
manifest and merges in on top; the app does not declare it.

## `03-app-links.txt`

`adb shell pm get-app-links com.pubmaxx.app`. The verifier has picked the host
up from the intent filters and reports a state for it, which is the half this
branch can prove. The state is a FAILURE and is expected to be one: verification
reads `https://pubmaxxing.com/.well-known/assetlinks.json`, and the fingerprint
in that file is still the named placeholder because the signing certificate does
not exist until the Play account does. `docs/STORE_READINESS.md` section 8 owns
the weekend step that turns this green.

The `Signatures:` line is the DEBUG keystore's fingerprint, which is generated
on this machine and is not the app's identity. Do not paste it anywhere.
