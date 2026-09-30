# Documents and GitHub coverage

Read-only metadata snapshot: 30 September 2026. The scan starts at
`/Users/karanmanoharan/Documents`, detects actual `.git` roots, and stops
descending once it reaches one. It does not follow directory symlinks or read
secret, environment, browser-profile, ignored-file or unrelated source contents.
Dependency/build/cache directories are excluded where identified.

The inventory and disposition rows below describe initial collection.
The later private preservation check is recorded at the end of this receipt.

`git ls-files`, `git status --porcelain=v1 -z` and ignored-directory metadata
separate tracked, untracked and ignored material. `git ls-remote` checks the
current branch tip without fetching or changing another checkout. The raw
manifest is ignored as `documents-repos.local.json` beside this report.

## Actual roots

Twelve Git roots were discovered. Five belong to PUBMAXX, four are other
GitHub projects or upstream examples, one has no commit/origin, and two are
generated Swift dependency checkouts. The latter seven are excluded from
PUBMAXX publication. A tracked count says what Git indexes, not whether a dirty
working version has been pushed.

| PUBMAXX root under `Documents/projects/` | Tracked files | Untracked files | Ignored directory entries | Current branch head on GitHub |
| --- | ---: | ---: | ---: | --- |
| `pubmaxx` | 14,858 | 81 | 22 | Exact main head `76de20674`. All 81 untracked paths are under `.agents`; no uncommitted app source was found in this snapshot. |
| `pubmaxx-audit` | 14,423 | 2,078 | 399 | Exact `codex/full-product-audit` head `9cc8c5336`. One dirty product-audit document remains local. Most untracked entries are proof, not intended app source. |
| `pubmaxx-full-audit` | 14,547 | 55 | 10 | Exact `codex/full-repository-audit-20260921` head `04b73e834`. No candidate app/source edit found outside proof. |
| `pubmaxx-ios-onboarding` | 14,231 | 6,289 | 10 | Exact `codex/ios-onboarding-actions` head `e599972c1`. Dirty CSS, one untracked E2E file and selected proof remain separate from that committed head. |
| `pubmaxx-jev-review-dedup` | 14,552 | 4 | 0 | Current branch is not advertised remotely. Three advisory prototype files remain untracked. |

Ignored counts are directory-level inventory entries, not recursive file
counts. Untracked counts include generated and proof material before filtering.
Neither count is a missing-feature count.

Outside PUBMAXX, `NalaTask` and `karan-machine-setup` have GitHub origins with
newer or differing current branch tips. That difference alone does not prove
local work is missing remotely. `dotfiles` and `launch-your-agent` have exact
current branch-head matches. Their local changes remain in their own roots and
their own repositories. They are not copied into `Singularityszn/pubmax`.

`Documents/NalaTask 2` is a standalone folder, not one of the discovered Git
roots. Metadata discovery found three source-like files there. Their intent
and equivalence to `karanmrn/NalaTask` were not established by reading or
publishing unrelated source. No remote-storage claim is made for that folder.
Other unlabelled personal Documents content is outside this coverage claim.

## Intended PUBMAXX source destinations

The earlier audit already prepared selective historical retention. This pass
found the following dirty/untracked intended source candidates still in their
original Documents roots. The table records each retained original path and
any recovery destination without overwriting live code or bulk uploading proof.
Where a row names no backup or GitHub copy, none is established.

| Current source | Exact destination or disposition |
| --- | --- |
| `pubmaxx-ios-onboarding/app/onboarding/onboarding.css` | Retained only as the original local file `/Users/karanmanoharan/Documents/projects/pubmaxx-ios-onboarding/app/onboarding/onboarding.css`. No separate backup or GitHub preservation of this dirty version is established, and it is not in the reviewed archive. Current `Singularityszn/pubmax:app/onboarding/onboarding.css` is only a possible future integration destination after owner review in an owned isolation. A historical dirty version is not authorised to replace current v0 layout. |
| `pubmaxx-ios-onboarding/e2e/native-onboarding-actions.spec.ts` | Already selected for `docs/proof/source-preservation-20260929/reviewed-source.zip`, archive entry `native-onboarding/e2e/native-onboarding-actions.spec.ts`. Live integration would target `e2e/native-onboarding-actions.spec.ts` only after current native acceptance. |
| `pubmaxx-jev-review-dedup/__tests__/reviewFindingDedup.test.mjs` | Same reviewed archive, entry `review-prototype/__tests__/reviewFindingDedup.test.mjs`. No live pipeline activation. |
| `pubmaxx-jev-review-dedup/docs/agents/review-finding-dedup.md` | Same reviewed archive, entry `review-prototype/docs/agents/review-finding-dedup.md`. Keep advisory status. |
| `pubmaxx-jev-review-dedup/scripts/review-finding-dedup.mjs` | Same reviewed archive, entry `review-prototype/scripts/review-finding-dedup.mjs`. No new generic review framework added. |
| `pubmaxx-audit/docs/audits/2026-09-07-product-audit.md` | Retained only as the original local file `/Users/karanmanoharan/Documents/projects/pubmaxx-audit/docs/audits/2026-09-07-product-audit.md`. No separate backup or GitHub preservation of this dirty version is established. No public destination is assigned because its dated acceptance claims and private proof references are unreviewed. It does not replace this current receipt. |

The complete archive manifest in the owning audit worktree additionally names
16 harvest source/test entries and one skip-link E2E entry. Their exact retained
destination is the same archive, under `harvest/` and
`skip-link/e2e/landmark-and-sheet.spec.ts`. Two old dependency-tooling versions
are superseded by the owned compatible-upgrade lane. Do not restore them over
current package files.

The 21-file archive is local to
`/Users/karanmanoharan/.codex/worktrees/pubmaxx-audit-20260929/docs/proof/source-preservation-20260929/reviewed-source.zip`.
This pass recomputed its SHA-256 and matched the original manifest:
`e6ba03d79d335aa2614e15fe861562eb2bdc5acb5a26b4ee7de4e717304d1c3b`.
This pass inspected the local manifest and hash, not a new remote copy. Existing audit
no-mistakes run owns its publication. No duplicate archive was staged here.

## Standalone PUBMAXX folders

The 29 September audit recorded 486 files across 14 matched non-repository
roots, with 18 exact byte matches in available GitHub history. Those historical
counts are retained as bounded evidence, not a new exhaustive scan. This pass
confirmed the actual Documents roots and sampled metadata-only proof-folder
classification. Browser traces, recordings, private receipts and generated
native outputs remain local.

Reviewed summaries belong under `Singularityszn/pubmax:docs/proof/<owned-task>/`
after their owner verifies and selects them. An arbitrary proof-folder file has
no automatic public destination. A renamed or unlabelled folder may be outside
the discovered set; absence of a byte match is not proof of lost work.

## Publication boundary

This branch publishes only the four reviewed Markdown receipts and `.gitignore`
in `docs/proof/remaining-task-closeout-20260930/`. It never stages another
checkout, standalone folder, `.env` file, profile, private user data, fixture
state, generated output or unrelated repository. GitHub publication of this
receipt does not publish the owner-held archive or deliver its historical code.

## Private preservation follow-up

At 10:15 UTC on 30 September, separate local copies of the two excluded dirty
versions were independently compared with their originals. Both were byte
equal, with these SHA-256 hashes:

| Original under `Documents/projects/` | Bytes | SHA-256 |
| --- | --- | --- |
| `pubmaxx-ios-onboarding/app/onboarding/onboarding.css` | 17,917 | `8d125ceacaaeddf75dbef163b000bfe0f9c6b0da8d71f30eae874b63c2e106f5` |
| `pubmaxx-audit/docs/audits/2026-09-07-product-audit.md` | 132,464 | `4e45d9b1f02337758d69b4ffa31d8803d2c103b516ea30f5e39f776298893188` |

Snapshot root:
`/Users/karanmanoharan/.local/state/pubmaxx-gnhf-20260930/private-preservation/snapshot-close-two-20260930T101329701762Z`.
Copies retain their project-relative paths beneath `snapshots/`.
`RESTORE_MANIFEST.json` in that root records exact origins, hashes, Git state
and restore constraints. The root is mode `0700`; copies and manifest are
`0600`. The preservation receipt records stable original pre/post hashes and
unchanged scoped Git state; this lane independently checked current equality,
hashes, permissions and manifest readability.

These private local copies close the separate-copy gap. They establish no
GitHub backup or public disposition, and no original file was overwritten.
Restoration or integration still needs current owner review. The existing
21-entry archive remains unchanged and separately owned. No private source
body, audit links or diff is published here.
