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
These baseline checks score structured cards. The fail-closed subsets below also check answer text, hours and heritage.

`__tests__/palFailClosedPrices.test.ts` adds twelve single-venue price asks from
`fail-closed-prices.json`: ten unknown prices and two known prices with named
sources. The test checks these references against the committed venue dataset
before it runs the real keyless `runAsk` path. Global network access fails the test.

The `priceAnswer` expectation checks prices in the answer and card text as well
as structured card prices. Unknown prices require a complete absence statement
about the requested price. Known prices require the recorded value and publisher
on the same card.
Replay tests insert invented prices, remove sources, and omit the known value.
Run this subset with `npx vitest run __tests__/palFailClosedPrices.test.ts`.

These are bounded code checks for single-venue pint-price questions. They detect
numeric pound and pence amounts, including bare decimals. They do not grade
spelled-out amounts or every possible refusal wording. They do not cover
the hosted Pub Pal agent or the Night Architect MCP tools.

`__tests__/palFailClosedHours.test.ts` tests the `hoursAnswer: { value: null }`
expectation. It requires a complete statement about missing hours. It rejects
numeric clock times, noon, midnight, 24-hour claims, and common open/closed claims
in the answer or card notes. These wording checks are bounded patterns. They do
not cover spelled-out times or every possible refusal or opening-status phrase.

Both absence checks accept bounded refusal forms for their own topic.
An optional venue name must match the referenced venue's indexed name or alias.
The grader does not trust card titles as names. A venue suffix cannot consume
extra predicates such as "remain unknown" or "have changed".
`__tests__/palEvalGrade.test.ts` covers these shared absence forms and false positives.

The hours suite checks named-pub matching, source selection and refusal behaviour
through `runAsk`. [ADR 0014](../../docs/adr/0014-night-os-ask-agent.md) owns the
routing and evidence rules.

The hours dataset in `fail-closed-hours.json` contains twelve real-venue asks.
Ten venues have no hours in the current dataset. Two venues have recorded hours
from their named websites. The test checks these references against the venue
records before it runs `runAsk` without network access.

The known `hoursAnswer` expectation requires every recorded weekday and time in
the answer. The matching venue card must carry those hours and their named
source, date and URL. Extra numeric times and common opening-status claims fail.
Replay tests alter a time, change a weekday, remove a day, and replace a source.
The code checks require the current schedule format. They do not judge equivalent
free-form wording or spelled-out times.

The grader detects unsupported `24:00` claims in answers and card notes.
It accepts `24:00` when the reference schedule records it.
Run the hours subset with `npx vitest run __tests__/palFailClosedHours.test.ts`.
The [Pub Pal feature guide](../../README.md#features) owns user-facing support and limits.

`__tests__/palFailClosedHeritage.test.ts` adds twelve real-venue heritage asks
from `fail-closed-heritage.json`. Ten venues have no recorded heritage. The Argyll
Arms and The Clachan have facts with named sources and source URLs. The test
checks each reference against the current local heritage reader and venue index.

This subset calls `runAskTool("venue_heritage")` with the canonical venue ID.
It does not test typed-question routing. See the
[heritage routing follow-up](FOLLOW_UPS.md) for that known product gap.

The `heritageAnswer` expectation rejects extra prose in answers and card notes.
Unknown heritage requires one of four explicit absence statements and no source.
Known heritage requires the recorded facts, their named sources and exact URLs.
The card containing the facts must also contain matching provenance. Replay tests
add dates, people and listing grades, change a fact, and remove or replace sources.

These code checks accept a bounded set of answer forms. They do not judge
paraphrases. A future wording judge must not replace the fact and source checks.
The three subsets now hold 30 unknown asks and six known asks. All run in the
normal offline test lane. The hosted assistant adapters and an opt-in live run
of these subsets remain unfinished. `eval:pal:live` does not run them.
Run the heritage subset with `npx vitest run __tests__/palFailClosedHeritage.test.ts`.

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
