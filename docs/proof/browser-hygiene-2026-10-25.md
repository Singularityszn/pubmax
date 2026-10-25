# Browser acceptance, 25 October 2026

This lane adds browser regression coverage without changing product behaviour.
Its starting commit is `a87240e748c859556b3604db508db257af96ca03`.
The branch is `codex/battle-browser-hygiene-1025`.

## Evidence

The browser used local Chromium at desktop 1280px and phone 390px widths.
The private development server used port 3217 and this lane's installed dependencies.
These results do not establish production-build, hosted, physical-device or real-provider authentication acceptance.

| Finding | Observed result |
| --- | --- |
| F10 | Existing Pints ranking tests passed for priced pubs, unpriced pubs, bars and restaurants at both widths. Both Riverside index-truncation cases passed. |
| F18 | The existing signed-in import review and save test passed at 390px. New tests verify the signed-out gate, failed matching, preserved text, retry, cleared input and keyboard focus restoration at both widths. |
| F19 | New tests navigate Home, Tonight and Home before denying analytics. The decision remains denied through `/map?log=1`, Tonight, Home and reload at both widths. |
| F20 | New tests open and close the first native `Why this pub` disclosure with Enter at both widths. The explanation becomes visible. |
| F21 | New coverage collects actual internal links from Home, Tonight, Plan and Credits. Each collected target resolves below HTTP 400 through GET. |

The import tests use the repository's provider-shaped browser authentication doubles and intercepted import responses.
They do not contact a production account or save a real night draft.
F4 and F5 retain the coordinator's earlier read-only evidence and existing regressions.
This lane does not replace that evidence or claim a fresh run of those journeys.

## Verification limits

The complete new spec passed all seven cases in 54.6 seconds.
The final link-receipt run checked 64 unique internal targets. All returned HTTP 200.
The existing import review test also passed, and the four selected Pints ranking cases passed across focused runs.
ESLint and `git diff --check` passed for the changes.

Cold development compilation restarted the server during initial browser attempts.
An initial desktop ranking attempt exceeded its 30-second budget.
The unchanged test passed in 22.2 seconds with a 120-second invocation budget.
The consent test initially inherited the suite's returning-visitor denial.
It now clears that choice once and waits for real route hydration before navigating.

The coordinator owns full verification, the production build, the publication gate and the preview PR.
No merge, production deployment, settings change or migration occurred in this lane.

Ledger's production screenshot shows the floating Create control over an aged-price warning.
The local keyless ledger lacked that public report, so this lane did not establish matching hitbox evidence.
The shared chrome issue remains open for a fixture-backed reproduction.

Raw screenshots and browser results remain in `artifacts/hygiene-*` in this worktree.
The link test writes its exact GET receipts and attaches them to the Playwright result.
