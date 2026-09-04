# PUBMAXX Pub Pal character sheets, September 2026

Status: implementation contract for the seven rendered forms. This sheet
replaces the layered-SVG rows of `docs/PUB_PAL_CHARACTER_SHEETS_2026-07-16.md`.
The species table, the state vocabulary and the legacy aliases in that file
still hold.

Captain decision, 4 September 2026: the seven species stay. Circuit Robin,
Greyhound and Black Cat were already rendered masters and set the family look.
Fox, Pigeon, Badger and Corgi were code-drawn SVG rigs and are now rendered
masters cut from the same family. Every form is a raster now, and
`lib/pubPal.ts` names one asset slug per species.

## The family

Cyberpunk here means the circuit robin, not the genre. Every form is one warm
living animal with a signal glow and a soft toy-like finish on a solid deep
night ground. The anchor below was reused word for word in every generation
prompt, with the three original masters attached as reference images.

| Element | Rule |
|---|---|
| Body | Soft matte black plush, felt-like, no shine on the fur |
| Eyes | Two round glowing soft-cyan discs, widely spaced |
| Chest | One large rounded coral circuit disc, warm glow, a few sparse right-angled traces with dots at the ends |
| Traces | Thin amber hairline circuit traces on ONE pair of appendages only |
| Cheeks | Two faint rose blush spots |
| Ground | Solid near-black night, a slightly wet floor carrying a soft warm reflection |
| Camera | Centred, full body, facing the viewer, about 80 percent of the square |
| Silhouette | Four to seven large soft rounded shapes, large head, compact body, every tip blunt, readable at 32 px |

Refused in every prompt and every result: text, watermark, borders, neon grid
floors, city skylines, glitch effects, scanlines, scattered circuitry noise,
purple or violet neon, chrome faces, visors, goggles, headphones, wires and
antennae.

## Species sheets

Each species keeps its silhouette line, face and signature prop from
`PAL_VISUAL_MANIFEST` in `lib/pubPal.ts`. The material column in that manifest
is now the family material for all seven, because the old per-species
materials (copper hologram, oil-slick chrome with teal and violet bands,
brushed graphite, warm chrome with cream panels) were the SVG rigs' palettes
and would have broken the family.

### Fox

- Silhouette: two large blunt-tipped upright ears, a short tapered muzzle, a big soft brush tail curled around the feet.
- Face: curious wide cyan eyes, an alert tapered muzzle with a tiny dark nose.
- Signature prop: a small round route compass on a short cord at the chest.
- Amber traces: the ears.
- Idle pose: leaning forward on its toes, tail curled in front.

### Pigeon

- Silhouette: round city pigeon with a proud puffed chest, a small round head, a short blunt beak, two little folded wings, two small feet.
- Face: a side-eye, the head turned so one eye is fully visible and the other only just, with a tiny knowing brow.
- Signature prop: a small rounded transit tag on a short cord around the neck.
- Amber traces: the folded wings.
- Idle pose: one foot forward, head tilted a little toward the viewer.

### Badger

- Silhouette: low wide badger with a broad flat head, two small round ears, a long blunt muzzle, two bold matte-white face stripes from the ears to the nose, a wide low body.
- Face: steady calm cyan eyes set in the stripes, a reassuring blunt muzzle with a dark nose.
- Signature prop: a small rounded night lantern with warm amber glass, held close against the chest.
- Amber traces: the ears.
- Idle pose: planted firmly and square on all four feet, lantern held close.

### Corgi

- Silhouette: short-legged corgi with oversized rounded upright ears, a soft round head, a short muzzle, a stubby body and a small stub tail.
- Face: eager round cyan eyes and an open happy grin with a tiny tongue.
- Signature prop: a soft crew band worn across the chest like a light harness.
- Amber traces: the ears.
- Idle pose: sitting with the front paws wide, ready to celebrate.

## The three treatments on the review board

Six candidates per species, two draws of each treatment, labelled A1, A2,
B1, B2, C1, C2. The same three treatments were used for every species so the
board compares like with like.

| Treatment | What differs |
|---|---|
| A, plush signal | The coral chest disc is the dominant glow. The prop is small, matte and unlit. Closest to the three originals. |
| B, prop forward | The signature prop is the thing that glows, in the same coral-and-amber light. The chest disc sits smaller behind it. |
| C, signal seam | The chest disc stays, and one clean amber seam runs from it up over the head and down the back. The expression and the tilt of the head carry the personality. |

## Where this departs from the ip-as-logo skill, and why

- Centred, not corner-emerging. The rendition pipeline (`scripts/gen-pubpal-mascot.mjs`) centre-crops a square and cuts a circular avatar from it, so a character emerging from a corner would lose its head in the avatar.
- Cyan eyes as a fourth colour. The skill asks for two subject colours plus a background. The three originals already wear cyan eyes, coral-and-amber signal and black plush, so the family keeps that count.
- Reference images were attached. The skill forbids references when testing prompt-only reproducibility; here the point is the opposite, holding four new forms to three existing ones.

## Generation record

- Model: `openai/gpt-5.4-image-2` (GPT Image 2) through OpenRouter, main-prompt constraints, 1024 by 1024, three reference images per call.
- A `google/gemini-3-pro-image` draw of Fox A1 was made as a model test. It was cleaner but dropped the wet-floor reflection and the family's lighting, so GPT Image 2 produced every board candidate.
- Winners, picked by the captain on the review board on 4 September 2026: Fox C2 (signal seam), Pigeon C1 (signal seam), Badger C2 (signal seam), Corgi B1 (prop forward). Masters stay outside the repo; only the renditions under `public/pal/` are committed.

## Review checklist

- The seven forms remain distinguishable at 36 px and full portrait size.
- Every 512 webp square stays under `PAL_MASCOT_WEBP_512_BUDGET`.
- Hologram, chrome and glass treatments in `PubPalAppearance.material` change the portrait frame and nothing in the bitmap.
- Listening, thinking, speaking, celebrating, sleeping and error states do not imply an unconfirmed action.
- No alcohol quantity, ranking or reward behaviour is encoded in the character system.
