# Pixel 7 emulator

AVD `pubmaxx`, API 36 `google_apis` arm64, gesture navigation, headless under
`swiftshader_indirect`, WebView 133 (below the version Capacitor trusts to pass
safe-area insets through, so the WebView is inset from the system bars), synced
against a local keyless production build of the branch under review at
`http://10.0.2.2:3811`.

| Folder | What it holds |
| --- | --- |
| `launch/` | The system splash and the band under the clock, before and after |
| `tonight/` | The page in light and after the OS switched to dark |
| `deeplink/` | `/tonight` and `/map?sel=` opened through `am start -a VIEW -p com.pubmaxx.app` |
| `composer/` | The Pint Drop composer under the keyboard, before and after the sheet re-cap |
| `back/` | Hardware Back with the sheet open, then into history |
| `share/` | The share button before (an error line) and after (the OS picker) |
| `offline/` | A cold start with wifi and data off, and after reconnecting |
| `textscale/` | The page and the pub sheet at font scale 2.0 |
| `nav/` | The pub sheet under three-button navigation |
| `memory/` | The map before and after ten minutes of panning |

Driving it: `adb shell input tap` in screen pixels (three per CSS pixel on this
AVD's 1170x2532 override), `adb shell cmd uimode night`, `settings put system
font_scale`, `cmd overlay` for the navigation mode, and the WebView's own
DevTools through `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
for every measurement quoted in a README.

## Memory after ten minutes of map use

Sampled with `dumpsys meminfo` on the app process and on the WebView renderer
(`com.google.android.webview:sandboxed_process0`) every minute while a script
panned the map in four directions six times a minute.

| | App process PSS | Renderer PSS |
| --- | --- | --- |
| Map open, cards dismissed | 148 MB | 242 MB |
| After 5 minutes | 145 MB | 241 MB |
| After 10 minutes | 144 MB | 242 MB |

Flat: no growth across the soak on either process. The renderer's figure is
the map's, and the emulator's software GL inflates it against a phone's GPU.

## Cold start

`am start -W` to the activity displayed, three cold starts in a row on this
emulator: 5314 ms, 3727 ms, 3853 ms. The page's own first paint follows the
activity by the network fetch of the document; `../ios-sim-iphone17pro/launch/`
records the same sequence on the simulator (launch screen to first content in
about 2.7 s against the local server).
