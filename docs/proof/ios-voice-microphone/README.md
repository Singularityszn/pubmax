# iOS microphone permission proof

Recorded on 7 October 2026. The baseline was `origin/main` at
`3bc62e232be88dcbfa564ecb01970aba68afa9de`.

The iOS 27 iPhone 18 Pro simulator ran an unsigned Release shell. It loaded a
local production Next.js build at `http://localhost:38113`. This is local native
proof, not a production deployment or an authenticated ElevenLabs session.

## Before and after

The baseline plist had no `NSMicrophoneUsageDescription`.
[The crash report](before-crash.json) records `SIGABRT` with the termination
namespace `TCC`. Its reason names the missing microphone explanation. The
report's `osVersion` describes the Mac host, while the simulator runtime was
iOS 27.0.

After adding the explanation, the same native permission request displayed
[the system microphone prompt](after-permission-prompt.png). The built plist
contained `Pub Pal uses your microphone when you start a voice chat.`
Review later changed the wording to the `APP_NAME` form, `PUBMAXXING uses your
microphone only while you talk to Pub Pal or dictate a note or a plan.` The key
is the same, so the crash proof still holds. The new wording was not captured
on the simulator.

After `simctl privacy ... grant microphone com.pubmaxx.app` and a relaunch,
the permission callback returned `true`. [The capture log](after-capture.txt)
records active WKWebView audio capture and an activated `PlayAndRecord`
audio session. The app remained running at the later process check.

[The regression output](regression-test.txt) records one failure before the
fix and all 27 native-wrap tests passing after it.

## Reproduction limits

The baseline shell first failed at launch because this SDK requires UIScene.
A temporary scene manifest and `SceneDelegate` enabled the simulator run.
The final source excludes both.

The simulator's WKWebView uses `Mock audio device 1`. Its `getUserMedia`
request bypassed the system privacy prompt. A temporary launch probe therefore
called `AVAudioSession.sharedInstance().requestRecordPermission` to exercise
the actual TCC check. It also called
`navigator.mediaDevices.getUserMedia({ audio: true })`, the request that
`PubPalVoiceSession` uses. The native probe was identical before and after
the plist fix. The final source excludes the native probe.

The prompt screenshot proves that the native explanation renders. The later
permission grant used `simctl`, so this proof does not claim an Allow-button
tap or a live ElevenLabs connection.

## Existing platform handlers

Capacitor iOS 8.5.2's `WebViewDelegationHandler` already grants media capture
through `requestMediaCapturePermissionFor`. The app keeps that delegate,
including for `pubmaxxing.com`, instead of adding another web permission prompt.
WebKit itself selected and activated `PlayAndRecord` during the measured capture.

Capacitor Android 8.5.2's `BridgeWebChromeClient.onPermissionRequest` requests
`RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` for audio capture. It grants the
WebView request after permission, and denies it after refusal. `MainActivity`
keeps that handler. The manifest now declares both permissions and makes
microphone hardware optional, so text and pub discovery remain available.

Android XML validation passed. The Android build could not start because this
Mac has no JDK 21. Android runtime behaviour remains unverified.

## Repository checks

The recovery run completed every `npm run verify` check. Coverage passed
20,998 tests with one skipped test. PostgreSQL passed 554 tests, and the
separate shared-memory suite passed 10 tests.

The `verify:no-mistakes` wrapper then exited 1 because macOS denied access
to the shared Git metadata during bundled-data cleanup. After Firstmate
confirmed that Full Disk Access was restored, the same cleanup wrapper
exited 0. Git status showed only this task's changes.

The final focused run passed all 30 native-wrap and voice-session tests.
The plist and Android manifest also passed syntax checks. The command
results are recorded in [the validation summary](validation.txt).

## Real iPhone checks

An authenticated real iPhone still needs these checks:

1. Start Pub Pal voice, allow the system microphone prompt, and confirm that the ElevenLabs session connects.
2. Confirm that speech reaches Pub Pal and its reply plays through the speaker and Bluetooth audio.
3. End the session, start another session, and confirm that capture stops and restarts without a second web prompt.

The independent UIScene launch prerequisite must also reach the binary built
with the iOS 27 SDK. This change contains no scene lifecycle changes or deploy.
