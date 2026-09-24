# Pal evals

Graded regression suite for Pub Pal / Night OS Ask (keyless `runAsk` path).

## Layout

- `cases.public.json` — queries the harness may run (no expected answers).
- `answer-key.json` — hidden expectations read only by graders (never sent to a model).
- `scoreboard/` — output from `npm run eval:pal:live`.

## Commands

- `npm run eval:pal` — deterministic gate (`skipModel: true`), fast enough for CI via vitest.
- `npm run eval:pal:live` — calls OpenRouter when `OPENROUTER_API_KEY` is set; writes `scoreboard/latest.json` and `latest.md`.

Regenerate expectations after intentional data or routing changes:

`node --conditions=react-server --import tsx scripts/regenerate-pal-answer-key.mjs`
