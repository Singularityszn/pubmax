# Battle pack implementation, 23 October 2026

This work is preview-only. No production writes, merges, promotions, setting changes, or migrations were performed by this task.

## Implemented changes

| Finding | Change | Evidence scope |
| --- | --- | --- |
| F9 | Home opens the existing pub picker with a blank price. Near me requires a tap and preserves the saved camera. | Local desktop and phone browser checks, focused unit tests. |
| F7 | Ledger reads the shared public pint selection through its existing uncached endpoint. Invalid and future reports cannot lead. | API tests for three venue records, privacy tests, local browser replay. |
| F8 | The exact known smoke account is excluded from public reads and saved-list metadata. | Public policy tests and local HTTP checks. |
| F15 | Today refreshes the London date and daypart after hydration. Tube refresh pauses in hidden tabs. | Controlled clock, lifecycle tests, local browser check. |
| F16 | Known area roots redirect to their canonical map area. Unknown or ambiguous roots stay 404. | Route tests and local HTTP checks. |
| F12 | Shared garden, outdoor-seating, and Open now controls show loaded-result counts. Slim records retain sourced feature facts. | Source tests and desktop/phone browser checks. |
| F13 | Map counts loaded pubs. Pint Index counts its defined London pub cohort across base and published menu sources. | Counting, source-eligibility, partial-read, rendering, and trace tests. |
| F11 | One permitted Small Beer menu read produced 19 supported prices. Social now shows the existing area review dates. | Captured source, parser tests, generated bundle, local browser check. |

## Limits that remain

- The project still cancels Git builds through its unchanged Ignored Build Step. See [build-path.md](build-path.md).
- The broad pint snapshot remains dated 2 October. One refreshed pub does not meet the seven-day snapshot target.
- Route readiness remains 3 of 47 areas. No new readiness claim was invented.
- Older menu rows remain in history. A successful extraction cannot prove that absent items were removed from a menu.
- The `/updates` page remains limited to verified released changes. This task adds no unreleased notes.
- Tonight source-date and Pints search work remains owned by PR #2339. This task does not duplicate it.
- Local browser emulation does not establish physical-device or signed-in hosted acceptance.

## Verification record

The initial full verification passed on baseline `2f18459e18d35507479478d9f4bf3187d524e6d1` before integration.
It reported 43,423 unit tests passed and one skipped, then 681 PostgreSQL tests and 10 session tests passed.
The freshness gate reported two stale datasets and three unmeasurable store feeds as advisory findings.
These results are baseline evidence, not final-head acceptance.

The first three combined repairs also passed 109 focused tests and the TypeScript check.
Final integration verification, build, independent review, and browser results are recorded separately when completed.

Every implementation agent retained its worktree and raw evidence. The task's integration branch is `codex/battle-integration-1023`.
