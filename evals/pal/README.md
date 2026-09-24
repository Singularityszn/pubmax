# Pal evals

Graded regression suite for Pub Pal / Night OS Ask (keyless `runAsk` path).

## Layout

- `cases.public.json` — queries the harness may run (no expected answers).
- `answer-key.json` — hidden expectations read only by graders (never sent to a model).
- `scoreboard/` — output from `npm run eval:pal:live` (git-ignored).

## Commands

- `npm run eval:pal` — deterministic gate (`skipModel: true`), fast enough for CI via vitest. CityMCP is the offline stub in `offlineFetch.ts`, shared with the Ask route tests, `TYPESAFE_API_KEY` is cleared for the run so routing is the regex cascade, and every case is asked at the `now` pinned in `answer-key.json` (an evening the bundled What's On fixtures cover).
- `npm run eval:pal:live` — calls OpenRouter when `OPENROUTER_API_KEY` is set, with every other source offline so the same answer key applies; writes `scoreboard/latest.json` and `latest.md`. Cost per case is the `usage.cost` OpenRouter reports, and a case where the model never called an Ask tool (so the regex router answered) fails its `model_ran` check.

Regenerate expectations after intentional data or routing changes. The script rebuilds the generated fields offline and keeps hand-authored `answerIncludes`, `anyTools` and `priceTolerance`:

`npm run regenerate:pal-answer-key`
