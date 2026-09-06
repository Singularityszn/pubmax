# iOS launch screen, before and after

Rig: iPhone 17 Pro simulator, iOS 26.5 runtime, Xcode 26.6, 7 September 2026.
The shell was synced against a local keyless production build of this branch
(`PUBMAX_NATIVE_SERVER_URL=http://localhost:3811`), so every frame after the
launch screen shows the checkout, not production.

## Before

`cold-start-1200ms.png`, `cold-start-2700ms.png` and `cold-start-5700ms.png` are
three frames of one cold start on the committed `LaunchScreen.storyboard`
(video: `cold-start-light.mp4`). The launch screen is a plain frame and the
first thing a reader sees of the app is a white WKWebView.

Held on screen with `xcrun simctl launch --wait-for-debugger`, the storyboard
draws PURE BLACK: not the ink field, not the coral mark, not even the
`systemBackgroundColor` it declares. Two rebuilt variants proved the storyboard
route is dead on this runtime rather than the image: a root `UIView` with the
imageview as a constrained subview launched black, and a root view painted
coral with NO image launched black.

## After

`launch-screen-after-light.png` and `launch-screen-after-dark.png` are the same
held launch on the `UILaunchScreen` Info.plist launch screen: `LaunchBackground`
(the ink token, one entry for both appearances) and `LaunchMark` (the master
splash's own centre at 1x, 2x and 3x). Both are written by
`scripts/gen-native-app-icons.mjs` and held by `__tests__/nativeSplashArt.test.ts`.
