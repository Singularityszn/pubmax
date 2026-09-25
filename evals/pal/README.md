# Pal evals

Graded regression suite for Pub Pal / Night OS Ask (keyless `runAsk` path).

## What a right answer means here

The hidden answer key is derived from the committed venue and price data: it records what the current keyless Ask returns for each question at the pinned `now` (tools used, cards or honest empty, top venue and its recorded price), plus hand-authored answer checks. Accuracy is therefore regression accuracy against that behaviour, not a verdict that every answer is ideal. The invented-venue and price checks are absolute: every card's `venueId` must exist in `public/data/venues_slim.json`, and every directory pint price must match its record.

Known Pal gaps are tracked in `FOLLOW_UPS.md` and are deliberately not changed by this suite. Fixing one is a product change: update the matching answer-key entries in the same commit, and remove the gap from `FOLLOW_UPS.md`.

## Layout

- `cases.public.json` — queries the harness may run (no expected answers).
- `answer-key.json` — hidden expectations read only by graders (never sent to a model).
- `scoreboard/` — output from `npm run eval:pal:live` (git-ignored).

## Commands

- `npm run eval:pal` — deterministic gate (`skipModel: true`), fast enough for CI via vitest. CityMCP is the offline stub in `offlineFetch.ts`, shared with the Ask route tests, `TYPESAFE_API_KEY` is cleared for the run so routing is the regex cascade, and every case is asked at the `now` pinned in `answer-key.json` (an evening the bundled What's On fixtures cover).
- `npm run eval:pal:live` — calls OpenRouter when `OPENROUTER_API_KEY` is set, with every other source offline so the same answer key applies; writes `scoreboard/latest.json` and `latest.md`. Cost per case is the `usage.cost` OpenRouter reports, and a case where the model never called an Ask tool (so the regex router answered) fails its `model_ran` check.

Regenerate expectations after intentional data or routing changes. The script rebuilds the generated fields offline at the pinned `now` and keeps it, along with hand-authored `answerIncludes`, `anyTools` and `priceTolerance`:

`npm run regenerate:pal-answer-key`

The pinned `now` is data: it must be an evening the bundled What's On fixtures cover, or the quiz and tonight cases grade nothing. After a What's On refresh, move `now` in `answer-key.json` to an evening the new fixtures cover, then regenerate. The script refuses to turn a case that expected cards into an empty one, and names the cases, so a stale `now` cannot quietly empty the key.
