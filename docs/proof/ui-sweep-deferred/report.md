# Deferred UI review delivery evidence, 9 October 2026

R1 is a local matching-boundary defect.
The duplicate record's removal preserved spelling aliases for search but omitted those aliases from permalink keys.
The fix applies the existing spelling owner at the shared permalink boundary.
The matcher still requires exactly one matching venue.
Both route handlers, the server resolver, and the published venue data remain the exercised interfaces.

Before the fix, `/pub/the-black-friar-blackfriars` and `/venue/the-black-friar-blackfriars` both threw `NEXT_NOT_FOUND`.
This reproduction used Node 26.10.0, the actual GET handlers, the actual resolver, and the committed public datasets.
The Node probe supplied framework adapters for `server-only`, `next/navigation`, and `next/server` because dependencies were unavailable during that review.
It did not mock the venue index, resolver, slug matcher, alias data, or venue data.
This is route-handler evidence, not an HTTP server or production-build browser journey.

The final focused result is recorded in `focused-verification.txt`.
The first focused check incorrectly expected the bare `the-black-friar` alias to resolve to London.
The published Manchester venue makes that alias ambiguous, so refusing it is correct.
`focused-verification-first-attempt.txt` preserves that failed check.
The corrected checks require refusal of the ambiguous alias and preserve postcode-qualified links for both cities.
The second check used an incorrect London map URL for Manchester.
`focused-verification-second-attempt.txt` preserves that failed expectation.
The corrected Manchester expectation uses `/map/manchester?sel=venue-mcr-shidtf`.
The configured Vitest suites were not executed during that review because Vitest was unavailable.
The later Test phase owns those suites and the wider validation.
This review does not claim a build, full test gate, browser journey, native result, publication, merge, or deployment.

R2 is an evidence and acceptance-reporting defect.
The submitted plan incorrectly treated Firstmate004's technical triage as human acceptance.
The [corrected plan](verification-plan.md) owns the recorded native-date disposition and acceptance limits for renewed Review and Test.

## Preserved raw browser evidence

The following artifacts are byte-for-byte copies from the supplied archived evidence directory:

- [AX record](native-date-ax.json).
- [Browser snapshot](native-date-aria.txt).
- [Screenshot](native-date.png).

Archive directory:

`/Users/karanmanoharan/.no-mistakes/evidence/01M4EK9B1EN9AY790MBJMRN87K/current-production-028/evidence/collector/390-light/`.

The original archive remains unchanged.
The copied AX record exposes one `Date of birth Optional` parent name.
Its internal names include `Day Day`, `Month Month`, `Year Year`, and `Show date picker Show date picker`.
These files are supporting archived evidence. Their directory name does not prove correspondence to the current review HEAD.
This review makes no new production or native claim from those artifacts.

The recorded decision describes the original `native-date-minimal.json` comparison and explicit-label probe.
Neither original artifact was available in the supplied archive or this worktree.
The reconstructed [plain HTML comparison](native-date-comparison.html) preserves a runnable diagnostic scenario for the subsequent Test phase.
It compares a wrapping label with an explicit `for` label without application code.
The reconstructed fixture has no fresh browser result in the recorded review.
It does not substitute for the missing raw original evidence.

The [verification plan](verification-plan.md#native-date-evidence-invariant-and-scenarios) owns the subsequent evidence requirements.
