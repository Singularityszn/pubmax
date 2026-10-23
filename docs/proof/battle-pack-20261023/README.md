# Battle pack implementation, 23 October 2026

This work is preview-only. No production writes, merges, promotions, setting changes, or migrations were performed by this task.

## Implemented changes

| Finding | Change | Evidence scope |
| --- | --- | --- |
| F9 | Home opens the existing pub picker with a blank price. Near me requires a tap and preserves the saved camera. | Local desktop and phone browser checks, focused unit tests. |
| F7 | Ledger and the sheet use the same supported price evidence. The venue response carries scoped source evidence for browser-fetch failures. | Real-handler tests, controlled source fixtures, privacy tests, and local browser replay. |
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

Gate revision `7c713992fb8e08608ce27797c702130a35f83fa8` passed the full local verification command.
It reported 43,594 unit tests passed, one skipped, 681 PostgreSQL tests passed, and 10 session tests passed.
The later runtime pass included nine successful map-stability repetitions.
These results precede the follow-up changes below.

The retained `8b4e88cc` production build passed 142 focused checks for import gating, crawl labels, share metadata, and the initial Tonight payload.
Those receipts do not establish final-revision or signed-in persistence acceptance.

## Follow-up repairs

- Ledger now selects the supported Small Beer menu price, including its matching source and observation date.
- A controlled source fixture also proves that Ledger and the sheet agree when the browser's separate refresh request fails.
- Fractional measures remain attached to their own drink. Partial servings cannot become full-pint candidates.
- The parser retains exact adjacent drink names and complete decimal prices across its supported item separators.
- The final parser-focused run passed 454 tests. The two Ledger runs passed 196 and 166 tests respectively.
- Independent reviewers checked the final parser and Ledger corrections. These checks do not replace combined validation.
- Three obsolete browser assertions now check pub selection before a blank price form. Their repaired cases passed against the retained `8b4e88cc` build.
- A scoped dependency override removes the declared vulnerable Zod copy below CLI-config. An isolated compatibility check and OSV scan passed.

CLI-config also bundles a Zod 4.1.11 version marker in its compiled code.
The dependency override does not replace that code or prove complete upstream security remediation.
All other dependency pins and the install-script policy remain unchanged.

Final combined verification, build, and browser results remain pending at the time of this record.
Draft [PR #2347](https://github.com/Singularityszn/pubmax/pull/2347) retains the changes and existing browser evidence.

Every implementation agent retained its worktree and raw evidence. The task's integration branch is `codex/battle-integration-1023`.
