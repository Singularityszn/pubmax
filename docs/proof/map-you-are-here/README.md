# The reader's own dot, 20 September 2026

Rendered proof for #1724: the "you are here" dot and its accuracy ring on the
MapLibre canvas, option A. The dot is painted from `watchPosition` into the
`user-location` GeoJSON source and **nothing here moves the camera**.

- `390.png` - 390x844, the phone.
- `1440.png` - 1440x900, the desktop.

## How it was driven

A production build served from its own `NEXT_DIST_DIR`, on a private port so no
hand-started server could sit under the browser suite. Chromium was launched
with SwiftShader, geolocation granted at 51.515 / -0.09 with a 25 metre
accuracy, reduced motion on, and the sheets dismissed so the frame shows the
canvas rather than a panel over it. Neither shot moves the camera itself.

## What the shots say

Both frames carry the blue dot inside its translucent accuracy ring. The ring
reads about 34 pixels of radius at the zoom the near-me answer lands on, which
is the figure the expression predicts for 25 metres at latitude 51.5 (33.6px at
zoom 16, `lib/mapReaderPosition.ts`). The desktop frame also shows the transit
lines drawing UNDER the dot and the pins: `buildTransitLines` inserts them
before `user-location-accuracy`, and that anchor only exists because the ring's
`circle-radius` is a style MapLibre accepts.

The probe reading taken with each shot:

```
{"hasSource":true,"hasAccuracyLayer":true,"hasCoreLayer":true,
 "written":[-0.09,51.515],
 "rendered":[-0.09000018239021301,51.51500016998111]}
```

`written` is what the canvas handed the source and `rendered` is what a decoded
tile reads back, quantised to the tile grid. They are two different readings on
purpose, and `e2e/map-you-are-here.spec.ts` asserts the first exactly and the
second by distance.

The basemap tiles are blank in these frames because the rig had no vector
basemap; every layer in them is the app's own, which is what the proof is about.
