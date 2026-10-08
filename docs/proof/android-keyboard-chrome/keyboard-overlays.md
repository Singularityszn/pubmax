# Android keyboard and overlay proof

The baseline was the production build of `origin/main` at `3bc62e232`. Native screenshots use API 36. Browser proof uses the updated production build.

| Before | After |
| --- | --- |
| [Keyboard leaves chrome above the field](before/search-keyboard-webview133.png) | [WebView 157 search hides the tabs and FAB](after/search-keyboard-webview157.png) |
| [The planner keyboard offers a next-field key, not Go. A system dialog covers the sheet](before/planner-keyboard-enter-webview133.png) | [WebView 133 keeps the expanded sheet and focused field while typing](after/planner-keyboard-webview133.png) |
| [Filter controls lack clear edges and the dock exposes content](before/filters-webview133.png) | [412px browser: complete caption, bounded control, 24px checkbox, button fills and opaque dock](after/filters-browser412.png) |
| [The moment composer before the change. A system dialog and the consent card cover the page, so this capture does not show the FAB](before/moment-fab-webview133.png) | [The moment composer withdraws the FAB](after/moment-browser412.png). [The create menu has an outside-tap scrim and a close mark](after/create-menu-browser412.png). |

On WebView 133, native typing entered `Quiet in Soho`. The layout and visual viewport both shrank from approximately 839px to 527px. The field kept focus, the sheet kept its full snap, and the tabs and FAB acquired `isKeyboardHidden`. A native Enter key sent one `POST /api/plans/generate` with that exact query. No screenshot of the resulting planner state was captured.

The new focus regression failed before the callback fix because a keyboard state change reran the sheet-opening effect. The stable callback now preserves the open sheet and input focus during viewport changes.

All 72 focused unit tests passed. All five production browser regressions passed. They cover widths 320, 412 and 430, complete caption visibility, bounded filter content, the final drink row, actual dock hit ownership, reachable tabs, planner Enter, outside menu dismissal and composer routes. The native app instrumentation suite passed both tests on WebView 133 and WebView 157.

## Venue sheet detents above the dock

Every map sheet now stops above the dock. Only the full snap gives up the dock's height, so its top edge stays where it was. Half keeps its viewport fraction and grows to fit the sheet's header and footer. The venue sheet peeks at its header and command bar only, and its body is hidden there, so no row is cut. At 320x568 the venue command bar wraps to two rows, which a 125px peek clipped before this change. The venue footer has a 12px bottom gutter, because the portal already reserves the safe-area inset.

`e2e/mobile-shared-sheet-layout.spec.ts` holds the header and footer inside the sheet and the sheet inside the viewport at every detent and both sizes. At peek it also holds the body hidden and closed. It ran against a production build in desktop Chrome.

| Size | Peek | Half | Full |
| --- | --- | --- | --- |
| 390x844 | [peek](after/venue-peek-390x844.png) | [half](after/venue-half-390x844.png) | [full](after/venue-full-390x844.png) |
| 320x568 | [peek](after/venue-peek-320x568.png) | [half](after/venue-half-320x568.png) | [full](after/venue-full-320x568.png) |

## Open proof gaps and follow-up

The native filter screenshots still show partial caption and border painting despite complete DOM bounds. [WebView 133](after/filters-webview133.png) and [WebView 157](after/filters-webview157.png) retain that visual gap. Browser screenshots paint both correctly. Native paint diagnostics produced inconsistent results, and the private emulator disappeared after instrumentation. Firstmate authorised stopping native proof after the final rig attempt. Physical-device confirmation remains necessary for A16. These screenshots do not establish that its native paint defect is fixed.

The Android keyboard answer is read from window heights, because the shell has no native IME visibility signal. Two limits are accepted. A height-only window shrink with a field focused, such as a top and bottom split screen, keeps the taller baseline, so the tabs and FAB can stay hidden after the keyboard closes until the field blurs. If the keyboard hides itself during a rotation, the tabs and FAB stay hidden until the field blurs or the keyboard opens and closes again. A native IME bridge is a follow-up, not part of this branch.

The analytics consent prompt remains owned by [the signed-in QA change](https://github.com/Singularityszn/pubmax/pull/2051). Firstmate authorised leaving A14 as a follow-up while that change remains open. This branch does not change the consent prompt or claim its content sliver is fixed.
