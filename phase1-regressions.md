# Phase 1 regression handoff

Tests have NOT RUN. Production behavior remains uncorrected. No RED or GREEN result is claimed.

The starting head is `308c8ba7eb4c37229265f31407a4782e55be2eea`.
This handoff covers only the three selected findings.

## Changed files

- `__tests__/palLocalityRegression.test.ts` adds offline routing, owned-history, normalization, tool-query, and HTTP regressions.
- `__tests__/mapSearchRecoveryMembership.test.tsx` adds drawing and recovery membership regressions, plus selection and geography guards.
- `components/map/useMapVenueCollections.ts` contains the authorized extraction.
- `components/PubMap.tsx` calls that extraction.

## Findings and invariants

`review-remaining-3`: A supported place must remain usable when the ask adds polite words or amenity requirements.
HEAD already removes those qualifiers before checking place alternatives.
The two reported examples are positive guards, not claimed failures.
The new tests cover direct classification, same-area resolution, short follow-ups, and HTTP responses.
Genuine alternatives and missing places must retain provider routing.

`review-locality-unsupported`: An unsupported explicit place must not admit a local London answer or borrow an earlier supported place.
The shared resolver accepts extracted place text without requiring a supported area.
This is a validation defect at the shared locality boundary.
The current resolver returns the extracted Oxford phrase despite finding no supported area.
The local classifier accepts that truthy result.
London venue name and address matching can then produce Oxford Arms and Flying Horse on Oxford Street.
The fixtures contain both collisions and four pubs within the Soho area circle.
The tests use only owned user history and a mocked venue-loading boundary.
The HTTP tests deny paid routing with a controlled 429 response and deny all external fetches.
They expect the provider boundary, not an invented response field.

This invariant applies at `unambiguousAskArea`, both follow-up resolvers, history normalization, tool-query resolution, and local admission.
The server classifier feeds the HTTP budget decision.
The client also uses area resolution for locality and accepted-area decisions.
The tests do not mount the complete client chat.

`review-map-recovery-membership`: Recovery counts and candidates must describe pubs that the active drawing filters permit.
This is an ownership mismatch between query membership and effective drawing membership.
The current recovery array precedes both experience and venue-kind filtering.
The drawing array follows both filters and the explicit selection override.
The tests expect zero recovery members when Pints is off and only eligible members under the no-alcohol filter.
Both one-match and multiple-match cases are covered.
The automatic search action also receives the candidate count, so its existing public decision function is exercised.
The explicit banner count, single-pub recovery, multiple-pub recovery token, canvas dispatch, and camera input share this invariant.

## Extraction necessity and equivalence

The relevant collection derivation was private inside the large `PubMap` component.
The existing banner tests accept a supplied count, and the camera tests accept a supplied collection.
Neither boundary can expose a mismatch between the two collections.
The extraction moves the existing five memoized derivations into one production hook.
It preserves their expressions, dependencies, array order, and selection precedence.
The only input rename is `filters.query` to `query`.
The existing caller still supplies the same value.
Every production consumer still receives the same `filteredPubVenues`, `kindVisibleMapVenues`, or `canvasVenues` result.
The visible venue list still reads `kindVisibleMapVenues` before the explicit selection override.
No predicate, fallback, state, or recovery action changed.

The original input and output relationships remain:

| Input after search blur, without selection | Recovery IDs | Drawing IDs |
| --- | --- | --- |
| King One and King Two, Pints off | king-one, king-two | none |
| King One and King Two, no-alcohol view | king-one, king-two | king-two |
| King One and King Two, all kinds and experiences | king-one, king-two | king-one, king-two |

These relationships come from source tracing. They are not runtime measurements.
The tests assert the intended filtered recovery membership and therefore retain the reported failures for the caller's RED run.
The tests drive the post-blur collection inputs through the real filter and hook boundaries.
They do not simulate desktop focus events, mount all of `PubMap`, render WebGL, or prove the complete banner click journey.
The existing banner and camera tests remain unchanged and are included in the proposed command.

## Caller-owned focused command

Run this only after the author and review families release and the caller admits phase 2:

```sh
NODE_OPTIONS=--max-old-space-size=256 VITEST_MAX_WORKERS=1 /opt/homebrew/Cellar/node/26.12.0/bin/node node_modules/vitest/vitest.mjs run --pool=forks --maxWorkers=1 --no-file-parallelism __tests__/palLocalityRegression.test.ts __tests__/mapSearchRecoveryMembership.test.tsx __tests__/mapSearchRecoveryCamera.test.tsx __tests__/mapSearchEmptyState.test.tsx
```

The command uses the candidate's installed Vitest entry point.
It starts no configured full verification, subprocess command probes, server, browser, or live provider call.
No execution occurred in phase 1.

Expected RED causes are unsupported Oxford local admission and recovery membership before kind or experience filtering.
Polite qualifiers, amenity qualifiers, genuine ambiguity, and missing-locality cases are guards.
Import failures, fixture failures, resource failures, or an unexpected all-PASS result do not establish the requested RED evidence.

## Preserved files and limits

The file hashes match the supplied values:

| File | SHA-256 |
| --- | --- |
| `e2e/pubpal-voice-live.spec.ts` | `e4ca179753f3b3d80f5a53e7d3ae2b74fcf759f366303b6926b95271fb45ca35` |
| `e2e/helpers/finalVoiceReply.ts` | `d55d313226aef122d0dc629ff40825c6a420143cd040da5cf98b2e889a83d980` |
| `lib/contentSecurityPolicy.mjs` | `fcf066ac5e2f538fef2d301d3f0b64e1c5d9ca2c4d8ad939b29196fdb49d212e` |

No `runtime-transition.json` exists in the bounded worktree inventory.
No other project checkout was read, and no runtime adoption operation occurred.
The requested external artifact directory is outside the workspace boundary.
This handoff stays inside the current worktree instead.
The outer executor owns commits, review, RED, production fixes, GREEN, and all later phases.
