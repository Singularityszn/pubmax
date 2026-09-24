# Pal evals

Graded suite for Pub Pal / Night OS Ask.

## What a right answer means

The hidden answer key holds routing constraints (`expectedTools`, `anyTools`, `answerIncludes`). **Normative recall** comes from `normativeSpecs.ts`: grounded `runAskTool` calls over committed venue, price and What's-On data at the pinned `now`. Graders merge that with the Pal `runAsk` response and score recall, invented venues, price accuracy, and tool routing.

## Layout

- `cases.public.json` — queries only.
- `answer-key.json` — pinned `now` and hand-authored constraints.
- `normativeSpecs.ts` / `normative.ts` — data-derived ground truth.
- `scoreboard/` — live output (git-ignored).

## Commands

- `npm run eval:pal` — deterministic CI gate.
- `npm run eval:pal:live` — OpenRouter live lane.
- `npm run regenerate:pal-answer-key` — validates normative specs at pinned `now`.

See `FOLLOW_UPS.md` for known product gaps.
