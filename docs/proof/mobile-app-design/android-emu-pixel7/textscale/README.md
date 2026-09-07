# Android font scale 2.0

Rig: Pixel 7 emulator, `adb shell settings put system font_scale 2.0`, the
"Largest" step of the OS slider.

`tonight-font-2x.png` and `sheet-font-2x.png` (before): the WebView zooms every
text node by the OS scale, so the page reads at twice the size, and the six-tab
bar's labels ran into each other ("Places" into "Out") while the bar grew over
the consent card, whose second button lost its second word.

`after-tonight-font-2x.png`: the shell reads the zoom the WebView applied and
publishes it on `<html>` (`lib/nativeTextScale.ts`); at the large bucket the
tab bar shows its icons alone and keeps its height, and the consent card grows
instead of clipping. Measured through the WebView's DevTools:
`data-text-scale="large"`, root font-size 32px, tab label `display: none`.
