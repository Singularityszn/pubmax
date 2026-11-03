# PUBMAXX launch videos

Two square videos for organic posts on X. The words on screen carry each
story, so both work with the sound off.

| Item | Launch video | Pub Pal cut |
| --- | --- | --- |
| Story | Find a pub, build a plan, send it to the group. | Hire the Pub Pal: it does the admin, you do the night. |
| Length | 15 seconds, 450 frames | 20 seconds, 600 frames |
| Size | 1080 x 1080, 30 fps | 1080 x 1080, 30 fps |
| Video | H.264 (High), yuv420p, BT.709 | the same |
| Audio | AAC, 48 kHz stereo, about -16 LUFS | AAC, 48 kHz stereo, about -17 LUFS |
| Files | `out/pubmaxx-launch.mp4`, `-silent.mp4`, `-thumbnail.png` | `out/pubmaxx-pubpal.mp4`, `-silent.mp4`, `-thumbnail.png` |

Each silent cut is the same picture with no audio track.

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

## The Pub Pal cut

The idea: most apps are built to sell you something. This one you hire. A
job advert ("WANTED: Someone to sort tonight.") ticks off what the Pal does,
and the real 3D Pal takes the job. Then it works, and you clock off.

Every claim in it is shipped behaviour or an approved line:

| On screen | Where it comes from |
| --- | --- |
| "Knows the listed pint prices." | The Pal answers from listed prices (captured). |
| "Shows its sources." | Every Pal card prints its source and date (captured). |
| "Can't be bought." | `docs/VOICE.md`: "Nobody buys their way to the top." |
| "Pay: £0." and "Free for drinkers." | Root `AGENTS.md`: a drinker pays for nothing. |
| "Prices never for sale." | `docs/VOICE.md` and the launch kit's end card. |
| The ticker | The Pal's four picks, each with its source and the date it was read. |

The 3D Pal is the model the app ships (`public/brand/pals`, copied to
`public/models/circuit-robin.glb`). `components/PalModel3D.tsx` draws it with
three.js using the app's own scene from
`components/pal/originalPalMeshRenderer.mjs`: the same orientation, camera and
lights. Only the pose belongs to the video, and it is a pure function of the
frame.

`capture-pal-screens.mjs` records one signed-out journey:

1. `/pal/chat` and the ask "Quick one after work in Clapham under £5".
2. Four picks, each with its source, and the map of them.
3. The Pheonix card: £5.00, "Pint Prices. Source read 2 October 2026."
4. "Use this pub", which keeps it for tonight, then "Make it Stop 1".
5. The route Plan builds around it (The Pheonix, The Stonhouse, The Belle
   Vue), "Lock it in" and "Send to the crew".

The cut does not use the Pal's "Open in Plan" draft. That button carries the
ask over to Plan, not the drafted stops, so Plan can answer with other pubs.
Showing the draft and then a different route would misdescribe the product.

## Sound

`make-audio.mjs` synthesises every sound from sine waves and seeded noise:
the three chat pops, the clicks, the whooshes, the stamp, the end chime and
two 120 BPM music beds (15 seconds for the launch video, 20 for the Pal cut).
Nothing is sampled or downloaded, so there is no third-party licence. One bar
of a bed is 60 frames, and every scene cut lands on a bar line.

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

```bash
REMOTION_RENDERER_DIR=/tmp/remotion-renderer node video/launch/render.mjs --cut pal
```

Each command writes three files to `video/launch/out` and then checks them
with ffprobe: the composition's length, 1080 x 1080, 30 fps, H.264 in
yuv420p, AAC on the main file and no audio on the silent cut. It stops with an
error if a check fails. Chromium renders with SwiftShader's GL, which the 3D
Pal needs.

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

```bash
PUBMAX_CAPTURE_BASE=http://127.0.0.1:34567 node video/launch/capture-pal-screens.mjs
```

The first script writes the launch video's seven captures to `public/screens`
and the control positions to `screens.json`; the second writes the Pal cut's
seven `pal-*.png` captures and `pal-screens.json`. If the data changes and Feeley's is no longer in
the Clapham view, the script stops and names the step that failed. Choose
another pub with `PUBMAX_CAPTURE_PUB` and `PUBMAX_CAPTURE_PUB_NAME`, and check
the crops in `scenes/ProductStage.tsx`.

## Files

| File | What it does |
| --- | --- |
| `index.ts`, `Root.tsx` | The Remotion entry and root: both videos, their silent cuts and thumbnails, and the launch video's scenes on their own. |
| `pal/` | The Pub Pal cut: the job advert, the Pal at work, the price ticker, out of office, the end card and the thumbnail. |
| `components/PalModel3D.tsx` | The real 3D Pal, drawn frame by frame. |
| `LaunchVideo.tsx` | The timeline and the sound cues. |
| `theme.ts` | Colours, fonts, scene timings and the copy, exactly as the brief supplies it. |
| `scenes/` | The hook, the product stage (find, plan, share), the end card, the thumbnail and the night backdrop. |
| `components/ScreenCamera.tsx` | Crops and moves one capture, and maps a highlight onto it. |
| `components/Highlight.tsx`, `Headline.tsx`, `Brand.tsx` | The coral rings, the headlines and the logo lockup. |
