# iPhone 17 Pro simulator

iOS 26.5 runtime, Xcode 26.6, Capacitor 8.5 shell, no signing team, synced
against a local keyless production build of the branch under review.

| Folder | What it holds |
| --- | --- |
| `launch/` | The black launch screen before, the ink and coral launch screen after, light and dark; a cold-start recording |
| `icons/` | The home-screen icon in light and dark |
| `tonight/` | Cold start, the OS appearance switch the page ignored, the dark relaunch, and the Chromium proof of the follow |
| `out/`, `plan/` | The doubled top inset before and the single one after; the plan composer under the keyboard |
| `map/`, `places/`, `social/`, `you/`, `pal/` | Each tab in the shell, for the status bar and the safe areas |
| `share/` | The iOS share sheet from Tonight |
| `composer/` | Search to a pub sheet, and the sheet's field under the keyboard |

Driving the simulator: `xcrun simctl` has no tap, so taps are CGEvents posted at
the Simulator window (screen origin at the window's +27,+79 points, scale 1.0),
and the software keyboard is toggled with Command-K. `simctl launch
--wait-for-debugger` holds the launch screen on screen, which is how the black
frame was measured rather than guessed.
