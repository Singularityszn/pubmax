# Pal evals

Graded regression suite for the shared Night OS Ask tool registry via `runAsk`
(map Ask keyless path and the keyless `/api/pub-pal/chat` fallback). Production
Pal voice and the hosted-LLM typed path use the ElevenLabs agent
(`docs/PUB_PAL_SETUP.md`); this harness does not HTTP-drive `/api/pub-pal/chat`.

## What a right answer means here

The hidden answer key combines hand-maintained routing constraints (`expectedTools`, `anyTools`, `answerIncludes`) with **data-derived** expectations (`topVenueId`, `topPrice`, `minCards`, `expectEmpty`) computed from committed venue, price and What's On data at the pinned `now`. The resolver lives in `answerKeyResolver.ts` and never calls `runAsk` or `runAskTool`. Graders score the live Pal response against that key for recall, invented venues, price accuracy, and tool routing.

The key also encodes the current keyless Ask regression baseline at the pinned instant: when Pal behaviour intentionally changes, regenerate the key in the same commit. Known Pal gaps live in `FOLLOW_UPS.md`; update the key and `FOLLOW_UPS.md` together when a gap is fixed or re-baselined.

Invented-venue and directory price checks are absolute: every card `venueId` must exist in `public/data/venues_slim.json`, and directory pint prices must match the slim index within tolerance.

A directory card with a price fails when its venue has no recorded price. A null price remains valid.
These checks score structured cards. They do not detect invented values in answer text, opening hours or heritage claims.

`__tests__/palFailClosedPrices.test.ts` adds twelve single-venue price asks from
`fail-closed-prices.json`: ten unknown prices and two known prices with named
sources. The test checks these references against the committed venue dataset
before it runs the real keyless `runAsk` path. Global network access fails the test.

The `priceAnswer` expectation checks prices in the answer and card text as well
as structured card prices. Unknown prices require an explicit absence statement.
Known prices require the recorded value and publisher on the same card.
Replay tests insert invented prices, remove sources, and omit the known value.
Run this subset with `npx vitest run __tests__/palFailClosedPrices.test.ts`.

These are bounded code checks for single-venue pint-price questions. They detect
numeric pound and pence amounts, including bare decimals. They do not grade
spelled-out amounts or every possible refusal wording. They do not yet cover
hours, heritage, the hosted Pub Pal agent, or the Night Architect MCP tools.
The existing `eval:pal:live` command does not run this new subset.

`__tests__/palFailClosedHours.test.ts` tests the `hoursAnswer: { value: null }`
expectation. It requires an explicit statement about missing hours. It rejects
numeric clock times, noon, midnight, 24-hour claims, and common open/closed claims
in the answer or card notes. These wording checks are bounded patterns. They do
not cover spelled-out times or every possible refusal or opening-status phrase.

The hours test runs real offline questions about The Coronet. The shared search
tool now answers named opening-hours questions from existing records. It states
when hours are unknown and returns no unrelated pubs or map proposals.
The Crosse Keys case checks recorded hours with a named website and date.
Stale records cannot supply current hours. These questions bypass paid model
routing, including when provider keys are configured. The tool boundary uses
the original question, so speculative arguments cannot substitute another pub.

This covers explicit opening/closing hours and times questions. Open-now
questions, a larger hours corpus and a general known-hours grader remain
unfinished. The hosted Pub Pal agent and Night Architect still need their own
adapter checks.

Memory has its own suite: [`memory/`](memory/README.md) grades what Pub Pal
remembers about the person it is talking to (`npm run eval:pal:memory`).

## Layout

- `cases.public.json` — queries the harness may run (no expected answers).
- `answer-key.json` — hidden expectations read only by graders (never sent to a model).
- `answerKeyResolver.ts` — hand-maintained routing constraints (`PAL_EVAL_ROUTING`, which overwrite `expectedTools` on regenerate) and the independent data resolver for generated key fields.
- `scoreboard/` — output from `npm run eval:pal:live` (git-ignored).

## Commands

- `npm run eval:pal` — deterministic gate (`skipModel: true`), fast enough for CI via vitest. CityMCP is the offline stub in `offlineFetch.ts`, `TYPESAFE_API_KEY` is cleared for the run, and every case runs at the `now` pinned in `answer-key.json` (an evening the bundled What's On fixtures cover).
- `__tests__/askModelLoopMock.test.ts` (part of `npm run test`) — the keyed tool loop without a key or a bill. A local [aimock](https://github.com/CopilotKit/aimock) server answers OpenRouter's chat-completions wire from `__tests__/fixtures/aimock/ask-model-loop.json`, `OPENROUTER_BASE_URL` points `lib/ask/modelLoop.ts` at it, and `runAsk` runs the real tool handlers at this suite's pinned `now`. It pins the allowlist, the rejection of arguments that are not a JSON object, the three-round and three-calls-a-round caps, and the deterministic fallback on a missed deadline. The fixtures are hand-written in aimock's file format, not recorded tapes, so they prove the loop's contract and not a model's choices.
- `npm run eval:pal:live` — requires `OPENROUTER_API_KEY` (refuses to run without it); exercises the optional OpenRouter tool loop on `runAsk` (map Ask parity), not the ElevenLabs Pal agent. Only OpenRouter goes to the network; every other source stays on the offline stub. Adds a `model_ran` check per case that fails when the model made no tool call, and writes `scoreboard/latest.json` and `latest.md`.

Regenerate data-derived fields after venue, price, What's On, or routing changes:

`npm run regenerate:pal-answer-key`

The pinned `now` is data: it must be an evening the bundled What's On fixtures cover. After a What's On refresh, move `now` in `answer-key.json` to an evening the new fixtures cover, then regenerate. The script refuses to turn a case that expected cards into empty and names the cases.
