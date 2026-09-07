# iOS Larger Text

Rig: iPhone 17 Pro simulator, `xcrun simctl ui <udid> content_size
accessibility-extra-extra-extra-large`, the largest accessibility size.

`tonight-ax-xxxl.png` (before): nothing changes. Dynamic Type reaches only text
set in the `-apple-system-body` family, and this app's type is CSS px, so the
iOS text-size setting had no effect inside the shell at all.

`after-tonight-ax-xxxl.png`: the shell reads the preferred body size through
`@capacitor/text-zoom` and asks WebKit for it, clamped to 2.0x (Android's own
ceiling; the accessibility sizes run to 3.1x and a phone page cannot honestly
hold that). The page scales, the six-tab bar keeps its height and shows its
icons alone, as a native tab bar does at these sizes (the accessible name is
on each link), and the consent card grows above the bar instead of clipping
the disclosure and the way out. `lib/nativeTextScale.ts` is the seam;
`__tests__/nativeTextScale.test.ts` the pin.
