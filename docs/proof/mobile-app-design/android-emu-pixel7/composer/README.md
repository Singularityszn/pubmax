# The Pint Drop composer under the Android keyboard

Rig: Pixel 7 AVD, API 36, WebView 133, local keyless build of this branch,
opened through the app link `/map?sel=venue-xjf3n0&log=1` (the log intent).
Every number below was read through the WebView's own DevTools
(`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`).

## Before

`log-intent.png` is the composer as the link opens it. `keyboard-price.png` is
the same sheet after a tap on the price field: the field, the question above
it and the sheet's own header are gone off the top, and a strip of map shows
between the sheet's bottom bar and the keyboard.

The cause is not the keyboard and not the sheet's CSS. iOS Safari and Android
Chrome never shrink the layout viewport for the keyboard, and the app's
keyboard model (`lib/softKeyboard.ts`, `lib/keyboardInset.ts`) is built on
that. The Android WebView inside the Capacitor shell DOES shrink it: the OS
resizes the WebView by the keyboard's height, and `window.innerHeight` went
from 773 to 538. The sheet's resting height is a px value applied inline
(`openAtSnap` jumps to it, for the CLS reasons the hook records), so it
outranks the `dvh` caps in the stylesheet and stayed at 711px in a 538px
viewport: the sheet's top moved to -237px and the focused field to -139px.

```
before keyboard: innerHeight 773, sheet {top -2, h 711}
keyboard open:   innerHeight 538, sheet {top -237, h 711}, active INPUT {top -139}
```

## After

`components/mobile/useSheetHeightDrag.ts` re-caps an open sheet on `resize`,
jumping rather than springing because a resize is nobody's gesture, and
brings the field that holds focus back into its scroller.
`after-keyboard-price.png` is the same tap on the rebuilt page:

```
keyboard open:   innerHeight 538, sheet {top -21, h 495}, active INPUT {top 77}
```

`after-back-sheet.png`: Android Back with the keyboard down closes the sheet
and keeps the typed figure; `../back/` holds the Back sequence on its own.
`__tests__/sheetViewportShrink.test.tsx` holds the re-cap in jsdom.
