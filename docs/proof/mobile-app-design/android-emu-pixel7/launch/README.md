# Android launch: the system splash and the band under the clock

Rig: Pixel 7 AVD, API 36 `google_apis` arm64, gesture navigation, headless
under `swiftshader_indirect`, WebView 133. The shell was synced against a local
keyless production build of this branch (`PUBMAX_NATIVE_SERVER_URL=http://10.0.2.2:3811`).

## Before

`before-system-splash.png`: the Android 12+ system splash painted the launcher
icon in its white disc on a light Material grey. `drawable*/splash.png`, the
ink field with the coral mark, is only the window background AFTER the system
splash, and `AppTheme.NoActionBarLaunch` carried none of the SplashScreen
theme's own values, so the OS drew its defaults. iOS launches on ink and coral;
Android launched on grey and a white disc.

`before-settled.png`: the page, with a pure white band under the clock. This
emulator's WebView is 133, below the version Capacitor trusts to report safe
areas (`WEBVIEW_VERSION_WITH_SAFE_AREA_FIX = 140` in Capacitor's
`SystemBars.java`), so Capacitor insets the WebView from the system bars
instead of passing the insets through, and the theme's default white
`windowBackground` shows through the inset over an off-white page. A phone
with a current WebView gets edge-to-edge and never sees the band; a phone with
an old one saw browser chrome. `../tonight/os-dark-while-open.png` is the same
band in dark, a Material grey over the ink page.

## After

`after-system-splash.png`: `windowSplashScreenBackground` is the ink token,
`windowSplashScreenAnimatedIcon` is `drawable/ic_splash_mark.xml`, an inset of
the adaptive foreground so the double-struck X stays inside the OS's circular
mask (`after-system-splash-clipped-mark.png` is the same mark handed over
un-inset, with its four corners cut off), and `postSplashScreenTheme` hands
over to the app theme. The launch is the same ink and coral frame iOS shows.

`after-settled-light.png` and `after-settled-dark.png`: `android:windowBackground`
is the page's paper in `values/` and its dark paper in `values-night/`, so the
band an old WebView leaves is the page in both appearances.

`__tests__/androidLaunchTheme.test.ts` holds the theme, the colours and the
inset.
