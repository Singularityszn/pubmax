# Android system chrome proof

The baseline was the production build of `origin/main` at `3bc62e232`. The screenshots use an API 36 emulator.

| Before | After |
| --- | --- |
| [WebView 133: light window bands and an unreadable clock over the dark page](before/os-light-app-dark-webview133.png) | [WebView 133: dark window bands and readable white icons](after/os-light-app-dark-webview133.png) |
| The window followed Android's light theme. | [WebView 157: the page remains dark while Android uses light mode](after/os-light-app-dark-webview157.png) |

`PageSystemBars` retains Capacitor's inset handling. Its window background follows the explicit page style, including configuration changes. It uses the same light and dark surface colours as the web page.

`android:build` passed. The app instrumentation suite passed both tests on WebView 133 and WebView 157. The system-bar test calls the actual bridge plugin and checks dark, light, dark, and an OS-light configuration change.

Run the suite as `./gradlew :app:connectedDebugAndroidTest`. The project-wide `connectedDebugAndroidTest` fails after the app suite passes, in the generated `capacitor-cordova-android-plugins` module at `checkDebugAndroidTestDuplicateClasses` (kotlin-stdlib 1.8.22 against kotlin-stdlib-jdk7 and jdk8 1.6.21). That generated-module limitation predates this branch.

The older WebView retains Capacitor's compatibility insets. This change paints those reserved bands rather than changing their dimensions. The newer WebView uses Capacitor's edge-to-edge path. These are emulator proofs, not physical-device proofs.
