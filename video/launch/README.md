# PUBMAXX launch video

A 15-second square video for an organic post on X. It tells one journey:
find a pub, build a plan, send it to the group. The words on screen carry the
story, so it works with the sound off.

| Item | Value |
| --- | --- |
| Size | 1080 x 1080, 30 fps, 450 frames, 15 seconds |
| Video | H.264 (High), yuv420p, BT.709 |
| Audio | AAC, 48 kHz stereo, about -16 LUFS. The silent cut has no audio track. |
| Files | `out/pubmaxx-launch.mp4`, `out/pubmaxx-launch-silent.mp4`, `out/pubmaxx-launch-thumbnail.png` |

## What is real and what is drawn

Every frame of the app interface is a plain screenshot of a production build
of this repository, taken by `capture-screens.mjs`. The video only crops,
moves and fades those screenshots. Nothing in them is retouched.

The video draws these layers itself, in Remotion:

- the three group-chat bubbles ("Pub?", "Which one?", "Who's coming?"), which
  are illustrative and claim no feature;
- the headlines and the end card;
- the coral rings that point at a control. Their positions come from
  `screens.json`, which the capture script read from the page;
- the logo, drawn by the app's own `PubmaxxWordmark` and `PubmaxxMark`
  components from `lib/brandMark.mjs`.

The journey in the captures is one real session on the committed data:

1. `/map?area=clapham`. Feeley's is the "Cheapest in this view" pin at £4.70.
2. Feeley's pub card: "£4.70, Listed · collected 2 Oct", with the app's own
   illustrated sign, not a third-party photo.
3. "Make it Stop 1", then the planner's route around it: Feeley's £4.70, The
   Stonhouse £5.80, The Belle Vue £6.00, "£16.50 each for pints", and the
   route map the app drew ("Dashed lines show stop order only.").
4. "Lock it in" with the host name "Alex", then the saved plan's
   "Send to the crew".

The planner heads the route with the capture day ("Tue 3 Nov, 18:00"). To
show a different day, capture again on that day.

## Sound

`make-audio.mjs` synthesises every sound from sine waves and seeded noise:
the three chat pops, the clicks, the whooshes, the end chime and a 120 BPM
music bed. Nothing is sampled or downloaded, so there is no third-party
licence. One bar of the bed is 60 frames, and every scene cut lands on a bar
line.

## Fonts

`public/fonts` holds the exact latin files the app serves for Space Grotesk
(headlines) and Inter (supporting text). Both are under the SIL Open Font
Licence 1.1.

## Render it again

The renderer is not an app dependency. Install it once in a scratch folder,
at the same version as `remotion` in `package.json`:

```bash
npm i --prefix /tmp/remotion-renderer @remotion/renderer@4.0.539 @remotion/bundler@4.0.539
```

Then render from the repository root:

```bash
REMOTION_RENDERER_DIR=/tmp/remotion-renderer node video/launch/render.mjs
```

The command writes the three files to `video/launch/out` and then checks them
with ffprobe: 15 seconds, 1080 x 1080, 30 fps, 450 frames, H.264 in yuv420p,
AAC on the main file and no audio on the silent cut. It stops with an error if
a check fails.

To look at single frames while you edit, add `--frames 0,150,449 --frames-only`.

## Capture the screens again

Build and serve a keyless production build on a private port, then run the
capture script against it:

```bash
NODE_OPTIONS=--max-old-space-size=8192 NEXT_DIST_DIR=.next-prod NEXT_PUBLIC_SW_VERSION=local PUBMAX_TRACKED_OUTPUTS=public/data node scripts/run-with-restored-next-env.mjs npm run build
```

```bash
NEXT_DIST_DIR=.next-prod PUBMAX_E2E_KEYLESS=1 PLAN_IDEMPOTENCY_SECRET=$(openssl rand -base64 32) RATE_LIMIT_SALT=video-capture-rate-limit-salt-32-chars npx next start -p 34567 -H 127.0.0.1
```

```bash
PUBMAX_CAPTURE_BASE=http://127.0.0.1:34567 node video/launch/capture-screens.mjs
```

The script writes the seven captures to `public/screens` and the control
positions to `screens.json`. If the data changes and Feeley's is no longer in
the Clapham view, the script stops and names the step that failed. Choose
another pub with `PUBMAX_CAPTURE_PUB` and `PUBMAX_CAPTURE_PUB_NAME`, and check
the crops in `scenes/ProductStage.tsx`.

## Files

| File | What it does |
| --- | --- |
| `index.ts`, `Root.tsx` | The Remotion entry and root: the video, the silent cut, the thumbnail still and each scene on its own. |
| `LaunchVideo.tsx` | The timeline and the sound cues. |
| `theme.ts` | Colours, fonts, scene timings and the copy, exactly as the brief supplies it. |
| `scenes/` | The hook, the product stage (find, plan, share), the end card, the thumbnail and the night backdrop. |
| `components/ScreenCamera.tsx` | Crops and moves one capture, and maps a highlight onto it. |
| `components/Highlight.tsx`, `Headline.tsx`, `Brand.tsx` | The coral rings, the headlines and the logo lockup. |
