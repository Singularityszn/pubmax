# Pal evals

Graded regression suite for Pub Pal / Night OS Ask (keyless `runAsk` path).

## Layout

- `cases.public.json` — queries the harness may run (no expected answers).
- `answer-key.json` — hidden expectations read only by graders (never sent to a model).
- `scoreboard/` — output from `npm run eval:pal:live` (git-ignored).

## Commands

- `npm run eval:pal` — deterministic gate (`skipModel: true`, network refused), fast enough for CI via vitest.
- `npm run eval:pal:live` — calls OpenRouter when `OPENROUTER_API_KEY` is set; writes `scoreboard/latest.json` and `latest.md`. Cost per case is the `usage.cost` OpenRouter reports, and a case where the model never answered fails its `model_ran` check.

Regenerate expectations after intentional data or routing changes. The script rebuilds the generated fields offline and keeps hand-authored `answerIncludes`, `anyTools` and `priceTolerance`:

`npm run regenerate:pal-answer-key`
