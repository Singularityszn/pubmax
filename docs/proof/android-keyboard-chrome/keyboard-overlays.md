# Android keyboard and overlay proof

The baseline was the production build of `origin/main` at `3bc62e232`. Native screenshots use API 36. Browser proof uses the updated production build.

| Before | After |
| --- | --- |
| [Keyboard leaves chrome above the field](before/search-keyboard-webview133.png) | [WebView 157 search hides the tabs and FAB](after/search-keyboard-webview157.png) |
| [Planner Enter does not submit](before/planner-keyboard-enter-webview133.png) | [WebView 133 keeps the expanded sheet and focused field while typing](after/planner-keyboard-webview133.png) |
| [Filter controls lack clear edges and the dock exposes content](before/filters-webview133.png) | [412px browser: complete caption, bounded control, 24px checkbox, button fills and opaque dock](after/filters-browser412.png) |
| [The FAB appears on the moment composer](before/moment-fab-webview133.png) | [The moment composer withdraws the FAB](after/moment-browser412.png). [The create menu has an outside-tap scrim and a close mark](after/create-menu-browser412.png). |

On WebView 133, native typing entered `Quiet in Soho`. The layout and visual viewport both shrank from approximately 839px to 527px. The field kept focus, the sheet kept its full snap, and the tabs and FAB acquired `isKeyboardHidden`. A native Enter key sent one `POST /api/plans/generate` with that exact query. [The resulting planner state is captured here](after/planner-go-webview133.png).

The new focus regression failed before the callback fix because a keyboard state change reran the sheet-opening effect. The stable callback now preserves the open sheet and input focus during viewport changes.

All 72 focused unit tests passed. All five production browser regressions passed. They cover widths 320, 412 and 430, complete caption visibility, bounded filter content, the final drink row, actual dock hit ownership, reachable tabs, planner Enter, outside menu dismissal and composer routes. The native app instrumentation suite passed both tests on WebView 133 and WebView 157.

## Open proof gaps and follow-up

The native filter screenshots still show partial caption and border painting despite complete DOM bounds. [WebView 133](after/filters-webview133.png) and [WebView 157](after/filters-webview157.png) retain that visual gap. Browser screenshots paint both correctly. Native paint diagnostics produced inconsistent results, and the private emulator disappeared after instrumentation. Firstmate authorised stopping native proof after the final rig attempt. Physical-device confirmation remains necessary for A16. These screenshots do not establish that its native paint defect is fixed.

The analytics consent prompt remains owned by [the signed-in QA change](https://github.com/Singularityszn/pubmax/pull/2051). Firstmate authorised leaving A14 as a follow-up while that change remains open. This branch does not change the consent prompt or claim its content sliver is fixed.
