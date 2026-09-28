# Pal evals

Graded regression suite for the shared Night OS Ask tool registry via `runAsk`
(map Ask keyless path). Production Pal typed chat and voice use the ElevenLabs
agent (`docs/PUB_PAL_SETUP.md`); this harness does not drive `/api/pub-pal/chat`.

## What a right answer means here

The hidden answer key combines hand-maintained routing constraints (`expectedTools`, `anyTools`, `answerIncludes`) with **data-derived** expectations (`topVenueId`, `topPrice`, `minCards`, `expectEmpty`) computed from committed venue, price and What's On data at the pinned `now`. The resolver lives in `answerKeyResolver.ts` and never calls `runAsk` or `runAskTool`. Graders score the live Pal response against that key for recall, invented venues, price accuracy, and tool routing.

The key also encodes the current keyless Ask regression baseline at the pinned instant: when Pal behaviour intentionally changes, regenerate the key in the same commit. Known Pal gaps live in `FOLLOW_UPS.md`; update the key and `FOLLOW_UPS.md` together when a gap is fixed or re-baselined.

Invented-venue and directory price checks are absolute: every card `venueId` must exist in `public/data/venues_slim.json`, and directory pint prices must match the slim index within tolerance.

## Layout

- `cases.public.json` — queries the harness may run (no expected answers).
- `answer-key.json` — hidden expectations read only by graders (never sent to a model).
- `answerKeyResolver.ts` — hand-maintained routing constraints (`PAL_EVAL_ROUTING`, which overwrite `expectedTools` on regenerate) and the independent data resolver for generated key fields.
- `scoreboard/` — output from `npm run eval:pal:live` (git-ignored).

## Commands

- `npm run eval:pal` — deterministic gate (`skipModel: true`), fast enough for CI via vitest. CityMCP is the offline stub in `offlineFetch.ts`, `TYPESAFE_API_KEY` is cleared for the run, and every case runs at the `now` pinned in `answer-key.json` (an evening the bundled What's On fixtures cover).
- `npm run eval:pal:live` — requires `OPENROUTER_API_KEY` (refuses to run without it); exercises the optional OpenRouter tool loop on `runAsk` (map Ask parity), not the ElevenLabs Pal agent. Only OpenRouter goes to the network; every other source stays on the offline stub. Adds a `model_ran` check per case that fails when the model made no tool call, and writes `scoreboard/latest.json` and `latest.md`.

Regenerate data-derived fields after venue, price, What's On, or routing changes:

`npm run regenerate:pal-answer-key`

The pinned `now` is data: it must be an evening the bundled What's On fixtures cover. After a What's On refresh, move `now` in `answer-key.json` to an evening the new fixtures cover, then regenerate. The script refuses to turn a case that expected cards into empty and names the cases.
