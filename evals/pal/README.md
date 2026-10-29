# Pal evals

Graded regression suite for the shared Night OS Ask tool registry via `runAsk`
(map Ask keyless path and the keyless `/api/pub-pal/chat` fallback). Production
Pal voice and the hosted-LLM typed path use the ElevenLabs agent
(`docs/PUB_PAL_SETUP.md`); this harness does not HTTP-drive `/api/pub-pal/chat`.

## What a right answer means here

The hidden answer key combines hand-maintained routing constraints (`expectedTools`, `anyTools`, `answerIncludes`) with **data-derived** expectations (`topVenueId`, `topPrice`, `minCards`, `expectEmpty`) computed from committed venue, price and What's On data at the pinned `now`. The resolver lives in `answerKeyResolver.ts` and never calls `runAsk` or `runAskTool`. Graders score the live Pal response against that key for recall, invented venues, price accuracy, and tool routing.

Two authored policy terminals require complete, honest responses. Covent Garden
has no current late-food record. The bare Lamb query matches five distinct venue
records without a canonical alias joining them. Its input contains only a case
ID, query and city. It supplies no canonical venue ID or disambiguating context.

Each terminal requires the complete authored answer, no cards, proposals or
sources, ready status and exactly its declared tool. Extra prose, prices, hours
or heritage claims fail. This closed wording contract does not judge paraphrases.
Adversarial grader tests use real response objects and independent authored
references. They do not call the product resolver, matcher or ranker.

The declaration binds the exact public case, absence of turns and other context,
London city and pinned instant. Minimal evidence checks bind Lamb's name/alias
candidates, coordinates and relevant canonical alias edges. Covent checks bind
its area/name mappings and food option IDs. A relevant change requires oracle
review, including new Covent evidence or a disambiguated Lamb input. The check
does not hash unrelated whole datasets.

The Old Bank of England is listed exactly as `venue-lrlyh8` at 194 Fleet Street.
Its positive expectation remains unchanged. The grammar repair passed all 22
affected heritage tests, including four new regressions. The final consumer run
also passed with this repair and the regenerated key. Full verification,
browser acceptance, and live provider acceptance remain pending.

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
Ten venues have no hours in the current dataset. Lion & Unicorn has recorded
website hours. The Crosse Keys has copied Google Places hours with a checked
date. The test checks each reference against the actual venue records before
it runs `runAsk` without network access. See
[Places preparation](../../docs/rules/lib-venues-areas-listings-and-nights.md#google-places-venue-content)
for the shared build and test setup.

The known `hoursAnswer` expectation requires every recorded weekday and time in
the answer. The matching venue card must carry those hours and their named
source and date. Website evidence also requires its URL. Extra numeric times
and common opening-status claims fail.
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
`__tests__/askHeritageQuestion.test.ts` separately sends every question through
the real keyless `runAsk` path. Eleven names resolve to a unique venue.
The Millers Well name matches two unresolved records and must return an
ambiguity prompt without cards or sources. The canonical-ID subset continues
to test all twelve records. See the [identity evidence](FOLLOW_UPS.md).
Additional typed cases reject an unlisted longer name, preserve separate tool
subjects in a multi-pub question, and refuse duplicate names without using
punctuation to choose a record. These checks do not exercise a hosted provider.

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

Only a successfully validated authored policy terminal can bypass the generator's
existing cards-to-empty guard. A matching case ID alone grants no exemption.
Every other unexpected data-derived empty result still blocks regeneration.
Generated keys must come from the generator and must not be edited manually.
The validation record below states the completed offline checks and their limits.

The eval consumer revalidates authored policy declarations before product calls,
including when it loads an existing generated key. Stale inputs, relevant
mappings or evidence require review even if product behavior remains stale.
The food-only alias table is exposed as data and included in the Covent projection.
The Lamb projection includes leading-article/punctuation variants, recorded search
names, relevant canonical edges and clusters. Unrelated records do not invalidate it.
Grader-only adversarial tests import existing runtime exports. They exposed
22 assertion failures in the previous grader. All 86 grader and binding tests
passed after the implementation changed.

The Lamb projection also binds an independent admission-validity flag for each
identity. It checks pub kind or omitted kind, borough text, valid price shape,
finite coordinates and nonempty ID/name. A loss of eligible namesakes requires
review. Finite price changes do not invalidate the declaration.

Canonical connectivity reads the same three-file path catalog as the server.
The projection independently applies valid-target filtering and later-source
precedence. It binds transitive incoming and outgoing connections to relevant
Lamb IDs, including cross-file chains. Existing primary clusters remain bound.
Unrelated components and overwritten unrelated edges do not invalidate the policy.

## Offline validation recorded on 29 October 2026

The following checks ran against the owned source changes.

- The baseline grader run produced 22 assertion failures and six passes across
  28 cases. The failures exposed unsupported claims, actions, sources, status,
  and tool usage that the previous grader accepted.
- All 86 grader and policy-binding checks passed after the repair. These checks
  cover authored response objects, relevant evidence changes, and stale-key refusal.
- The real generator wrote 30 entries. Only the Covent Garden and Lamb
  expectations changed meaning. Old Bank, the other 27 cases, and the pinned
  instant retained their meaning. No one manually edited the key.
- All 22 affected heritage checks passed. These include the four Old Bank
  regressions and the unchanged 12-question heritage corpus.
- All 35 final consumer checks passed with the combined grammar and generated
  key. The five evaluation tests exercised the complete 30-question corpus,
  offline behaviour, pinned time, and regeneration parity. Eight sobriety tests
  and 22 heritage tests also passed. The run made no network or model calls.

The final run reused the 86-case evidence only for unchanged grader and binding
behaviour. The 35-case run checked the regenerated key and the combined grammar.
These totals overlap and must not be added as unique coverage.
Full verification, browser acceptance, and live provider acceptance remain pending.
