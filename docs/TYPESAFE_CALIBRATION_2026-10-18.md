# TypeSafe calibration report, 2026-10-18

A dated record, written by `node scripts/calibration_report.mjs`. It changes no threshold. The captain chooses which recommendations to adopt.

## How to read this

- Each case's TypeSafe answer was recorded once, offline, by the `scripts/record_*_probabilities.ts` scripts. This report calls no model.
- A **Choice** row is right when the chosen option was the right one. A **yes/no** row counts as yes when the right answer was yes, so its observed yes rate should match its mean P(yes).
- **Expected calibration error (ECE)** is the count-weighted gap between stated confidence and observed accuracy across ten bins. 0 is perfectly calibrated.
- A **recommendation** is the lowest threshold whose cases at or above it are at least 95% right, with the share of recorded cases that clear it. It is searched in steps of 0.01, the precision the floors in code use; the tables print tenths for reading. For a **refusal floor** it is the highest threshold whose cases at or below it are at least 95% right. The share is over the fixture cases, not over live traffic, because no live probabilities are logged.
- The samples are small (12 to 70 cases), so read the Wilson lower bound beside each accuracy before moving a threshold.

## Summary

| Decision | Cases | ECE | Threshold in code | Recommended |
| --- | ---: | ---: | ---: | ---: |
| Ask router: tool choice | 70 | 0.05 | 0.6 | 0.00 |
| Ask router: wantsMap | 70 | 0.09 | none | not thresholded |
| Pub Pal fence: fires | 44 | 0.10 | 0.33 | 0.14 |
| Pub Pal fence: fitToTravelAfterDrinking | 29 | 0.08 | none | not thresholded |
| Pub Pal fence: getHomeTonight | 44 | 0.12 | none | not thresholded |
| Same pub: merge | 10 | 0.16 | 0.82 | 0.43 (too few cases) |
| Same pub: refuse | 10 | 0.16 | at most 0.35 | at most 0.69 (too few cases) |
| Heritage listing: is the pub building | 12 | 0.05 | 0.8 | 0.16 (too few cases) |
| Heritage listing: refuse | 12 | 0.05 | at most 0.35 | at most 0.95 (too few cases) |

## Ask router: tool choice

- Data: `__tests__/fixtures/typesafe/ask-router-probabilities.json`, graded against the gold `regexTool` in `ask-router-cases.json` and the Pal answer key's `expectedTools`.
- Model `jev-1.13.0`, recorded 2026-09-21T06:02:12.028Z. Cases: 70.
- Threshold in code: `ASK_ROUTER_TOOL_FLOOR` in `lib/ask/routerPolicy.ts` = 0.6.
- Score compared with the threshold: the lower of the chosen tool's probability and confidence (both must clear the floor); a `none` choice never publishes.
- Expected calibration error: **0.05**.

| Bin | Count | Mean confidence | Accuracy |
| --- | ---: | ---: | ---: |
| 0.0 to 0.1 | 0 | n/a | n/a |
| 0.1 to 0.2 | 0 | n/a | n/a |
| 0.2 to 0.3 | 0 | n/a | n/a |
| 0.3 to 0.4 | 0 | n/a | n/a |
| 0.4 to 0.5 | 0 | n/a | n/a |
| 0.5 to 0.6 | 3 | 0.54 | 100% |
| 0.6 to 0.7 | 0 | n/a | n/a |
| 0.7 to 0.8 | 3 | 0.74 | 100% |
| 0.8 to 0.9 | 2 | 0.87 | 50% |
| 0.9 to 1.0 | 62 | 0.99 | 98% |

| Threshold | Cases at or above | Right | Wilson 95% low | Share clearing |
| ---: | ---: | ---: | ---: | ---: |
| 0.0 | 70 | 97% | 90% | 100% |
| 0.1 | 70 | 97% | 90% | 100% |
| 0.2 | 70 | 97% | 90% | 100% |
| 0.3 | 70 | 97% | 90% | 100% |
| 0.4 | 70 | 97% | 90% | 100% |
| 0.5 | 68 | 97% | 90% | 97% |
| 0.6 | 67 | 97% | 90% | 96% |
| 0.7 | 66 | 97% | 90% | 94% |
| 0.8 | 64 | 97% | 89% | 91% |
| 0.9 | 62 | 98% | 91% | 89% |

**Recommendation:** 0.00 is the lowest threshold, searched in steps of 0.01, whose cases at or above it are at least 95% right (97% of 70; 100% of the recorded cases clear it). The Wilson lower bound is 90%, so at this sample size the true accuracy could be that low.

Every case here is one the regex router already routes right, so these rows cannot show what the floor exists to prevent: a judged tool overriding a right regex route on a new ask. Record cases the regex gets wrong before lowering it.

## Ask router: wantsMap

- Data: the same recording; truth is whether `propose_map_action` is an expected tool.
- Model `jev-1.13.0`, recorded 2026-09-21T06:02:12.028Z. Cases: 70.
- Threshold in code: `ASK_ROUTER_WANTS_MAP_FLOOR` in `lib/ask/routerPolicy.ts` (confirmation only, never a veto).
- Expected calibration error: **0.09**.

| Bin | Count | Mean P(yes) | Observed yes rate |
| --- | ---: | ---: | ---: |
| 0.0 to 0.1 | 43 | 0.04 | 0% |
| 0.1 to 0.2 | 13 | 0.13 | 0% |
| 0.2 to 0.3 | 8 | 0.24 | 0% |
| 0.3 to 0.4 | 1 | 0.37 | 0% |
| 0.4 to 0.5 | 1 | 0.45 | 0% |
| 0.5 to 0.6 | 0 | n/a | n/a |
| 0.6 to 0.7 | 0 | n/a | n/a |
| 0.7 to 0.8 | 0 | n/a | n/a |
| 0.8 to 0.9 | 1 | 0.89 | 100% |
| 0.9 to 1.0 | 3 | 0.98 | 100% |

No threshold acts on this answer alone, so no threshold is recommended.

## Pub Pal fence: fires

- Data: `__tests__/fixtures/typesafe/pubPalFenceProbabilities.json`, graded against `expectFenced`.
- Model `jev-1.13.0`, recorded 2026-09-20T12:59:07.056Z. Cases: 44.
- Threshold in code: `PUB_PAL_FENCE_NOUL_THRESHOLD` in `lib/pubPalLlmFence.ts` = 0.33.
- Score compared with the threshold: the higher of the two yes/no answers; a case that does not clear it falls through to the regex fence.
- Expected calibration error: **0.10**.

| Bin | Count | Mean P(yes) | Observed yes rate |
| --- | ---: | ---: | ---: |
| 0.0 to 0.1 | 14 | 0.01 | 0% |
| 0.1 to 0.2 | 3 | 0.14 | 33% |
| 0.2 to 0.3 | 0 | n/a | n/a |
| 0.3 to 0.4 | 1 | 0.33 | 100% |
| 0.4 to 0.5 | 1 | 0.45 | 100% |
| 0.5 to 0.6 | 1 | 0.55 | 100% |
| 0.6 to 0.7 | 0 | n/a | n/a |
| 0.7 to 0.8 | 3 | 0.75 | 100% |
| 0.8 to 0.9 | 4 | 0.85 | 100% |
| 0.9 to 1.0 | 17 | 0.95 | 100% |

| Threshold | Cases at or above | Right | Wilson 95% low | Share clearing | Recall |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.0 | 44 | 64% | 49% | 100% | 100% |
| 0.1 | 30 | 93% | 79% | 68% | 100% |
| 0.2 | 27 | 100% | 88% | 61% | 96% |
| 0.3 | 27 | 100% | 88% | 61% | 96% |
| 0.4 | 26 | 100% | 87% | 59% | 93% |
| 0.5 | 25 | 100% | 87% | 57% | 89% |
| 0.6 | 24 | 100% | 86% | 55% | 86% |
| 0.7 | 24 | 100% | 86% | 55% | 86% |
| 0.8 | 21 | 100% | 85% | 48% | 75% |
| 0.9 | 17 | 100% | 82% | 39% | 61% |

**Recommendation:** 0.14 is the lowest threshold, searched in steps of 0.01, whose cases at or above it are at least 95% right (96% of 28; 64% of the recorded cases clear it, recall 96%). The Wilson lower bound is 82%, so at this sample size the true accuracy could be that low.

A missed fence is the harm here, so read recall beside accuracy: below the threshold the regex is the only net.

## Pub Pal fence: fitToTravelAfterDrinking

- Data: the same recording, cases whose labels settle the question.
- Model `jev-1.13.0`, recorded 2026-09-20T12:59:07.056Z. Cases: 29.
- Threshold in code: one half of the fence score.
- Expected calibration error: **0.08**.

| Bin | Count | Mean P(yes) | Observed yes rate |
| --- | ---: | ---: | ---: |
| 0.0 to 0.1 | 15 | 0.01 | 0% |
| 0.1 to 0.2 | 2 | 0.15 | 50% |
| 0.2 to 0.3 | 0 | n/a | n/a |
| 0.3 to 0.4 | 0 | n/a | n/a |
| 0.4 to 0.5 | 1 | 0.45 | 100% |
| 0.5 to 0.6 | 0 | n/a | n/a |
| 0.6 to 0.7 | 0 | n/a | n/a |
| 0.7 to 0.8 | 0 | n/a | n/a |
| 0.8 to 0.9 | 3 | 0.85 | 100% |
| 0.9 to 1.0 | 8 | 0.96 | 100% |

No threshold acts on this answer alone, so no threshold is recommended.

## Pub Pal fence: getHomeTonight

- Data: the same recording.
- Model `jev-1.13.0`, recorded 2026-09-20T12:59:07.056Z. Cases: 44.
- Threshold in code: the other half of the fence score.
- Expected calibration error: **0.12**.

| Bin | Count | Mean P(yes) | Observed yes rate |
| --- | ---: | ---: | ---: |
| 0.0 to 0.1 | 24 | 0.03 | 0% |
| 0.1 to 0.2 | 2 | 0.12 | 0% |
| 0.2 to 0.3 | 3 | 0.24 | 0% |
| 0.3 to 0.4 | 2 | 0.35 | 100% |
| 0.4 to 0.5 | 0 | n/a | n/a |
| 0.5 to 0.6 | 1 | 0.55 | 100% |
| 0.6 to 0.7 | 0 | n/a | n/a |
| 0.7 to 0.8 | 5 | 0.74 | 100% |
| 0.8 to 0.9 | 1 | 0.87 | 100% |
| 0.9 to 1.0 | 6 | 0.94 | 100% |

No threshold acts on this answer alone, so no threshold is recommended.

## Same pub: merge

- Data: `__tests__/fixtures/typesafe/same-pub-probabilities.json`, graded against the hand label `labelSame`; 24 rows labelled by the keyless heuristic are left out.
- Model `jev-1.13.0`, recorded 2026-09-20T14:20:55.210Z. Cases: 10.
- Threshold in code: `SAME_PUB_MERGE_THRESHOLD` in `lib/samePubIdentity.ts` = 0.82.
- Expected calibration error: **0.16**.

| Bin | Count | Mean P(yes) | Observed yes rate |
| --- | ---: | ---: | ---: |
| 0.0 to 0.1 | 0 | n/a | n/a |
| 0.1 to 0.2 | 2 | 0.11 | 0% |
| 0.2 to 0.3 | 0 | n/a | n/a |
| 0.3 to 0.4 | 1 | 0.32 | 0% |
| 0.4 to 0.5 | 1 | 0.42 | 0% |
| 0.5 to 0.6 | 0 | n/a | n/a |
| 0.6 to 0.7 | 0 | n/a | n/a |
| 0.7 to 0.8 | 1 | 0.70 | 100% |
| 0.8 to 0.9 | 1 | 0.89 | 100% |
| 0.9 to 1.0 | 4 | 0.94 | 100% |

| Threshold | Cases at or above | Right | Wilson 95% low | Share clearing | Recall |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.0 | 10 | 60% | 31% | 100% | 100% |
| 0.1 | 10 | 60% | 31% | 100% | 100% |
| 0.2 | 8 | 75% | 41% | 80% | 100% |
| 0.3 | 8 | 75% | 41% | 80% | 100% |
| 0.4 | 7 | 86% | 49% | 70% | 100% |
| 0.5 | 6 | 100% | 61% | 60% | 100% |
| 0.6 | 6 | 100% | 61% | 60% | 100% |
| 0.7 | 6 | 100% | 61% | 60% | 100% |
| 0.8 | 5 | 100% | 57% | 50% | 83% |
| 0.9 | 4 | 100% | 51% | 40% | 67% |

**Recommendation:** 0.43 is the lowest threshold, searched in steps of 0.01, whose cases at or above it are at least 95% right (100% of 6; 60% of the recorded cases clear it, recall 100%). The Wilson lower bound is 61%, so at this sample size the true accuracy could be that low.

Only 6 cases clear it, fewer than the 20 this report asks for before a floor moves. Keep the current threshold and label more cases first.

## Same pub: refuse

- Data: `__tests__/fixtures/typesafe/same-pub-probabilities.json`, graded against the hand label `labelSame`; 24 rows labelled by the keyless heuristic are left out.
- Model `jev-1.13.0`, recorded 2026-09-20T14:20:55.210Z. Cases: 10.
- Threshold in code: `SAME_PUB_REFUSE_THRESHOLD` in `lib/samePubIdentity.ts` = 0.35.
- A refusal floor: a P(yes) at or below it refuses, and a refusal is right when the hand label is no.
- Expected calibration error: **0.16**.

| Bin | Count | Mean P(yes) | Observed yes rate |
| --- | ---: | ---: | ---: |
| 0.0 to 0.1 | 0 | n/a | n/a |
| 0.1 to 0.2 | 2 | 0.11 | 0% |
| 0.2 to 0.3 | 0 | n/a | n/a |
| 0.3 to 0.4 | 1 | 0.32 | 0% |
| 0.4 to 0.5 | 1 | 0.42 | 0% |
| 0.5 to 0.6 | 0 | n/a | n/a |
| 0.6 to 0.7 | 0 | n/a | n/a |
| 0.7 to 0.8 | 1 | 0.70 | 100% |
| 0.8 to 0.9 | 1 | 0.89 | 100% |
| 0.9 to 1.0 | 4 | 0.94 | 100% |

| Threshold | Cases at or below | Right | Wilson 95% low | Share clearing | Recall |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.0 | 0 | n/a | n/a | 0% | 0% |
| 0.1 | 0 | n/a | n/a | 0% | 0% |
| 0.2 | 2 | 100% | 34% | 20% | 50% |
| 0.3 | 2 | 100% | 34% | 20% | 50% |
| 0.4 | 3 | 100% | 44% | 30% | 75% |
| 0.5 | 4 | 100% | 51% | 40% | 100% |
| 0.6 | 4 | 100% | 51% | 40% | 100% |
| 0.7 | 5 | 80% | 38% | 50% | 100% |
| 0.8 | 5 | 80% | 38% | 50% | 100% |
| 0.9 | 7 | 57% | 25% | 70% | 100% |

**Recommendation:** 0.69 is the highest threshold, searched in steps of 0.01, whose cases at or below it are at least 95% right (100% of 4; 40% of the recorded cases clear it, recall 100%). The Wilson lower bound is 51%, so at this sample size the true accuracy could be that low.

Only 4 cases clear it, fewer than the 20 this report asks for before a floor moves. Keep the current threshold and label more cases first.

## Heritage listing: is the pub building

- Data: `__tests__/fixtures/typesafe/heritage-structure-probabilities.json`, graded against the hand label `labelListingIsPubBuilding`.
- Model `jev-1.13.0`, recorded on a date the recording does not store. Cases: 12.
- Threshold in code: `HERITAGE_STRUCTURE_ACCEPT_THRESHOLD` in `lib/heritageListingStructure.ts` = 0.8.
- Expected calibration error: **0.05**.

| Bin | Count | Mean P(yes) | Observed yes rate |
| --- | ---: | ---: | ---: |
| 0.0 to 0.1 | 5 | 0.04 | 0% |
| 0.1 to 0.2 | 2 | 0.14 | 0% |
| 0.2 to 0.3 | 0 | n/a | n/a |
| 0.3 to 0.4 | 0 | n/a | n/a |
| 0.4 to 0.5 | 0 | n/a | n/a |
| 0.5 to 0.6 | 0 | n/a | n/a |
| 0.6 to 0.7 | 0 | n/a | n/a |
| 0.7 to 0.8 | 0 | n/a | n/a |
| 0.8 to 0.9 | 0 | n/a | n/a |
| 0.9 to 1.0 | 5 | 0.97 | 100% |

| Threshold | Cases at or above | Right | Wilson 95% low | Share clearing | Recall |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.0 | 12 | 42% | 19% | 100% | 100% |
| 0.1 | 7 | 71% | 36% | 58% | 100% |
| 0.2 | 5 | 100% | 57% | 42% | 100% |
| 0.3 | 5 | 100% | 57% | 42% | 100% |
| 0.4 | 5 | 100% | 57% | 42% | 100% |
| 0.5 | 5 | 100% | 57% | 42% | 100% |
| 0.6 | 5 | 100% | 57% | 42% | 100% |
| 0.7 | 5 | 100% | 57% | 42% | 100% |
| 0.8 | 5 | 100% | 57% | 42% | 100% |
| 0.9 | 5 | 100% | 57% | 42% | 100% |

**Recommendation:** 0.16 is the lowest threshold, searched in steps of 0.01, whose cases at or above it are at least 95% right (100% of 5; 42% of the recorded cases clear it, recall 100%). The Wilson lower bound is 57%, so at this sample size the true accuracy could be that low.

Only 5 cases clear it, fewer than the 20 this report asks for before a floor moves. Keep the current threshold and label more cases first.

## Heritage listing: refuse

- Data: `__tests__/fixtures/typesafe/heritage-structure-probabilities.json`, graded against the hand label `labelListingIsPubBuilding`.
- Model `jev-1.13.0`, recorded on a date the recording does not store. Cases: 12.
- Threshold in code: `HERITAGE_STRUCTURE_REFUSE_THRESHOLD` in `lib/heritageListingStructure.ts` = 0.35.
- A refusal floor: a P(yes) at or below it refuses, and a refusal is right when the hand label is no.
- Expected calibration error: **0.05**.

| Bin | Count | Mean P(yes) | Observed yes rate |
| --- | ---: | ---: | ---: |
| 0.0 to 0.1 | 5 | 0.04 | 0% |
| 0.1 to 0.2 | 2 | 0.14 | 0% |
| 0.2 to 0.3 | 0 | n/a | n/a |
| 0.3 to 0.4 | 0 | n/a | n/a |
| 0.4 to 0.5 | 0 | n/a | n/a |
| 0.5 to 0.6 | 0 | n/a | n/a |
| 0.6 to 0.7 | 0 | n/a | n/a |
| 0.7 to 0.8 | 0 | n/a | n/a |
| 0.8 to 0.9 | 0 | n/a | n/a |
| 0.9 to 1.0 | 5 | 0.97 | 100% |

| Threshold | Cases at or below | Right | Wilson 95% low | Share clearing | Recall |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.0 | 0 | n/a | n/a | 0% | 0% |
| 0.1 | 5 | 100% | 57% | 42% | 71% |
| 0.2 | 7 | 100% | 65% | 58% | 100% |
| 0.3 | 7 | 100% | 65% | 58% | 100% |
| 0.4 | 7 | 100% | 65% | 58% | 100% |
| 0.5 | 7 | 100% | 65% | 58% | 100% |
| 0.6 | 7 | 100% | 65% | 58% | 100% |
| 0.7 | 7 | 100% | 65% | 58% | 100% |
| 0.8 | 7 | 100% | 65% | 58% | 100% |
| 0.9 | 7 | 100% | 65% | 58% | 100% |

**Recommendation:** 0.95 is the highest threshold, searched in steps of 0.01, whose cases at or below it are at least 95% right (100% of 7; 58% of the recorded cases clear it, recall 100%). The Wilson lower bound is 65%, so at this sample size the true accuracy could be that low.

Only 7 cases clear it, fewer than the 20 this report asks for before a floor moves. Keep the current threshold and label more cases first.

## Not scored here

- Venue resolution (`venue-resolution-probabilities.json`): the recording keeps the chosen candidate slot (`c0`, `c1`, ...) but not which venue each slot held, so a choice cannot be graded without re-running the candidate search.
- Concierge intent (`conciergeIntentProbabilities.json`): several answers per case with no single threshold in front of them.
- Pint price judgment (`pint-price-judgment-probabilities.json`): the recording has no hand label to grade against.
- A comparison against another judge (TypeSafe's System One adapter or AnyJev) needs a live key and is not part of this offline report.
