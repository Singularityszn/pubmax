# The shell follows the OS appearance while the app is open

Rig: iPhone 17 Pro simulator, iOS 26.5, local keyless build of this branch.

`light-cold.png` is a cold start in light appearance. `os-dark-while-open.png`
is the SAME open app two seconds after `xcrun simctl ui <udid> appearance dark`:
the page stays light, because `public/theme-init.js` decides the theme once
before paint and nothing re-asked. `dark-relaunch.png` is the app after a
terminate and relaunch in dark appearance, where the page and the status bar
glyphs are both right, which shows the theme and the system bars were never the
problem, only the moment they were read.

A native app changes with the switch, and a phone that flips to dark at sunset
does so with the app on screen or in the background, which iOS resumes without
a reload. `components/native/NativeSystemBars.tsx` now listens to
`prefers-color-scheme` inside the shell and re-applies the one rule theme-init
uses (a stored choice wins; with none the OS decides, `lib/themePreference.ts`),
so the document flips and the system bars follow it through the existing
MutationObserver.

## Measuring the fix

The simulator cannot measure it. `xcrun simctl ui <udid> appearance dark`
changes what a NEW process reads and does not reach a running one on this
runtime: Safari itself, opened on the same page, kept its light chrome and its
light page after the switch, so the WebView never saw a `prefers-color-scheme`
change to react to. That is the rig, not the app, and a real iPhone delivers
the trait change live.

The after-measurement is therefore the stated fallback rig: Chromium (the
repo's own Playwright build) at the iPhone 15 Pro profile with the Capacitor
bridge stubbed so `isNativeApp()` answers true, loading the same local build
and flipping `prefers-color-scheme` through `emulateMedia`.
`theme-follow-chromium.mjs` is the script and it answered:

```
{"before":"light","afterDark":"dark","afterLight":"light","storedLightUnderDarkOs":"light"}
```

The document follows the OS both ways, and a stored choice still wins.
`__tests__/nativeThemeFollow.test.tsx` holds the same three facts in jsdom.
