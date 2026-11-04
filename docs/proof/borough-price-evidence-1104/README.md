# Borough price evidence

Recorded on 4 November 2026. This record covers source and mounted tests.
It does not claim production browser acceptance.

## Source and dependency

The feature branch starts at `origin/main` commit `445df3a6`.
It preserves Today dependency `93472bbd` through a local merge.
That history includes the selected-price evidence helper, shared receipt,
canonical onboarding repair and pure date formatter.
Those dependency files remain unchanged.

Publication onto main waits for the Today dependency or an approved existing stack.
No comparable-pint policy, loader or aggregate calculation changes in this slice.

## Before and after

| Surface | Actual failure before the edit | Checked result after the edit |
| --- | --- | --- |
| Borough index | The rendered row said `Westminster1 pubfrom£3.50`. | The amount retains its winning pub, selected drink, stated serving, publisher link and full read day. |
| Borough chapter | The pub row printed its drink and amount without a serving or receipt. | Each amount carries its own selected evidence. Map and price-history links remain. |
| CityMCP comparison | The mounted average omitted a complete day. The local comparison carried only an amount. | The average keeps its CityMCP label and actual complete London day. The separate local comparison retains its own winning pint and receipt. |

The real page exports render the index and chapter tests.
Their data boundary supplies price rows to the real grouping and selection code.
The CityMCP test mounts the real card and surface cache.
Only the external HTTP response is supplied by the test.
No provider request ran.

## Checks

Eight focused suites pass 162 tests with one worker and no retries.
They cover the new rendered and mounted cases, borough sorting and caching,
borough photographs, Today evidence, comparable rankings and the unchanged fact calculations.
Scoped lint has no warnings. Focused TypeScript checks pass.

The cases retain the first index tie and alphabetical chapter ties.
Non-public pubs and non-pint amounts do not become cheapest winners.
A refused figure remains visible in its pub row.
A tied later row cannot supply an earlier row's missing evidence.
Missing drink, serving, publisher and full read day use explicit words.
Incomplete or invalid CityMCP dates do not become invented calendar days.

Before logs and complete check output are retained outside source at:

`/Users/karanmanoharan/.codex/completion/v2-readiness-1104/borough-price-evidence/`

One initial chapter fixture omitted a required row identifier.
The corrected fixture then failed on the missing visible serving.
Two later test corrections used an in-band half price and the existing `Half` label.
Those intermediate failures remain in the evidence folder.

Root then found that the existing pub-row badge coloured a bottle against pint bands.
The actual bundled Bbar row reproduced this with a red expensive-pint band on its £9 bottle amount.
The existing serving rule now keeps that badge neutral.
The amount, bottle label, receipt, ordering and ordinary pint band remain checked.
The first band test used the wrong class spelling, then the corrected test reproduced the actual defect.
An initial type check required explicit fields for the selected evidence union.
That type failure remains preserved.

## Remaining acceptance

R6 owns the runtime family.
No install, app build, browser, provider, native run, index or hosted write ran here.
Phone layout, source-link hit areas, light/dark appearance and route budgets remain unmeasured.
The repository's final configured validation remains required before publication.

The shared FactBlock and pintFacts calculation are unchanged.
A separate audit found actual non-pint values in their average population.
Its source proposal must cover the population, extreme receipts, FAQ and share-card callers together.
