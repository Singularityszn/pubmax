# PUBMAXX completion and GitHub audit

Snapshot date: 29 September 2026. Local checkout inventory captured at 21:16 UTC. GitHub main was checked again after the inventory. Active work continued during the audit.

PUBMAXX work is not all complete, and every local artifact is not safely stored in GitHub. Most historical PRs have merged. Several current lanes, source edits and private proof bundles remain local or awaiting review.

## Verified repository and production state

| Record | Verified state |
| --- | --- |
| GitHub main | `76de20674da64604af22872ff42ee08fca7f156a` |
| Production alias `pubmaxxing.com` | Vercel READY deployment `dpl_HMqafPxYPcW1XwCbhSTfkMgfD9r6`, commit `b49b5850010d3cb0f28831cf548488cd1f54240e`, region `lhr1`. The coordinating lane inspected the deployment and aliases through the Vercel connector. |
| Newer main deployment | `dpl_7zrXynUdb6WXRNVq347zR6J72cXu`, CANCELED. The deployment inventory contains 24 newer cancelled entries before the READY production entry. |
| Change merged after production | [PR #1869](https://github.com/Singularityszn/pubmax/pull/1869), offline page caching and map drawer interaction. Its commit is main's one commit beyond the confirmed production head. |
| Public HTTP checks | `/`, `/about`, `/map` and `/out` returned 200. `/api/version` returned only `{"ok":true}`, so the public endpoint itself did not identify the release. |
| Browser and location | The coordinating lane observed signed-out production map rendering at 390 and 1440 pixels. This does not establish actual or simulated geolocation permission or the blue dot. |

[Production deployment inspector](https://vercel.com/pubmax69/chengdu/HMqafPxYPcW1XwCbhSTfkMgfD9r6) and [cancelled newer-main attempt](https://vercel.com/pubmax69/chengdu/7zrXynUdb6WXRNVq347zR6J72cXu).

## Coverage

- 1,375 matching local Codex chats inventoried. All corresponding session files existed. User and assistant message records were scanned throughout every matching session file, excluding tool payloads. Nine were marked archived in local metadata. A final-message record appeared in 623 chats; this is not a completion count.
- The sidebar connector exposes only its latest 50 chats. Thirty-five matched PUBMAXX by title or workspace. Its archived listing returned one chat, while local metadata contained nine archived matches.
- The ChatGPT chat named `PUBMAXX SEO priorities for next week` was read separately. Other older ChatGPT account histories are outside this verified coverage. The local Codex inventory cannot establish that every ChatGPT conversation was found.
- Documents, Downloads, Codex worktrees, Treehouse and no-mistakes folders were scanned without following directory symlinks or traversing dependency/build caches. Filename discovery found 152 Git candidates. Filtering established 52 PUBMAXX Git checkouts across two common Git directories.
- The main repository lists 50 worktree records, including three missing/prunable temporary paths. Five additional existing no-mistakes checkouts were inspected through their separate common Git directory. No worktree was removed or pruned.
- GitHub advertised 482 branch refs and 1,624 PR head refs. All 1,624 PR records and all 252 issue records were retrieved. A merge record proves GitHub delivery, not runtime correctness or deployment.

The message scan is an inventory and evidence extraction, not a semantic verdict that every request in every chat is satisfied. Historical messages can contain older state, partial handoffs or assertions contradicted by current GitHub records. Tasks without a matching commit, PR, test artifact or runtime observation remain unverified.

## GitHub completion ledger

| Record type | Count |
| --- | ---: |
| Merged PRs | 1,445 |
| Closed PRs without a merge | 170 |
| Open PRs | 9 |
| Closed issues | 220 |
| Open issues | 32 |

Of 170 closed, unmerged PRs, 138 heads are reachable from available live branch objects. Another 32 lack that branch-ancestry proof. GitHub still advertises all 1,624 PR head refs, so a removed branch alone does not mean its PR head disappeared. Closed without merge remains a distinct outcome from delivered to main.

Current open PRs:

| PR | Scope |
| --- | --- |
| [#1870](https://github.com/Singularityszn/pubmax/pull/1870) | Confirm unowned sign-ins and preserve modal focus. |
| [#1871](https://github.com/Singularityszn/pubmax/pull/1871) | City navigation, map clearance and modal focus. |
| [#1872](https://github.com/Singularityszn/pubmax/pull/1872) | Navigation and venue copy, shared logic. |
| [#1873](https://github.com/Singularityszn/pubmax/pull/1873) | Context.dev extraction and map drawer interaction. |
| [#1874](https://github.com/Singularityszn/pubmax/pull/1874) | Drink/city context through price logging and map navigation. |
| [#1875](https://github.com/Singularityszn/pubmax/pull/1875) | Drink-aware planning and saved price evidence. |
| [#1876](https://github.com/Singularityszn/pubmax/pull/1876) | Price evidence, offline caching and modal focus restoration. |
| [#1860](https://github.com/Singularityszn/pubmax/pull/1860) | Dependabot Context.dev upgrade. |
| [#1861](https://github.com/Singularityszn/pubmax/pull/1861) | WIP map/core-surface headless QA captures. |

## Historical requests checked against current evidence

| Request or lane | Evidence and remaining boundary |
| --- | --- |
| September copy rewrite and deploy | Copy commit `69203af077e21c2592475a87763dc6ff9c8daaa3` is an ancestor of both current main and confirmed production. The original deploy chat ended after initiating Vercel work without a returned READY result. Current production evidence now supersedes that historical gap for the copy's inclusion. Blue-dot permission proof remains absent. |
| Desktop design and drink-label harvest | [#1751](https://github.com/Singularityszn/pubmax/pull/1751), [#1755](https://github.com/Singularityszn/pubmax/pull/1755) and [#1748](https://github.com/Singularityszn/pubmax/pull/1748) are now merged. Historical pending handoffs are stale. This audit did not rerun their browser or harvest checks. |
| UI train, #1797 to #1799 | [#1797](https://github.com/Singularityszn/pubmax/pull/1797), [#1798](https://github.com/Singularityszn/pubmax/pull/1798) and [#1799](https://github.com/Singularityszn/pubmax/pull/1799) are now merged. Issues [#1538](https://github.com/Singularityszn/pubmax/issues/1538) and [#1544](https://github.com/Singularityszn/pubmax/issues/1544) are closed with reason completed. |
| PostHog #1845 | [#1845](https://github.com/Singularityszn/pubmax/pull/1845) merged on 27 September. Earlier CI pending/runner-failure notes are historical. No current-head CI success is inferred from the merge. |
| Reddit and Tavily evidence handoff | Named commits `36f38c773`, `3b7e2d5c7` and `b385f9669` are retained on live GitHub branches. Their original SHAs are not ancestors of current main. The handoff itself reported release checks unfinished. Exact commit retention is confirmed; current product inclusion needs patch/behaviour reconciliation. |
| Price-policy handoff | `d1cefbffa` is retained on live branch `cursor/restore-drinker-confirm-ui-afb4`, but its original SHA is not an ancestor of current main. Do not convert that fact into a claim that policy behaviour is missing; compare final implementation before restoring anything. |
| `Refine Pubmaxx v0` | Active owner continues in `v0-integration`. Snapshot had 79 source/test/docs edits and 87 commits without reachability from available live GitHub branch or PR anchors. Thread reports a successful repository gate, then outstanding performance and Core Web Vitals work. No final shipment is established by that report. |
| Venue-read convergence | [#1646](https://github.com/Singularityszn/pubmax/issues/1646) is open, but all five dirty files in its old worktree exactly match bytes stored in live GitHub history. Confirm the current main path and behaviour before building a duplicate fix or closing the issue. |
| Map-rail copy and route warming | [#1639](https://github.com/Singularityszn/pubmax/issues/1639) and [#1641](https://github.com/Singularityszn/pubmax/issues/1641) remain open. Their worktree heads are preserved in remote history; local proof files are separate. Issue closure is not established. |
| Three historical Firstmate inbox notices | The recorded inbox paths no longer exist. The imported chats show reads, but no conclusive action/archive/empty-queue evidence. Missing directories do not prove queue completion. Associated PR delivery must be assessed separately. |
| SEO/source research chat | Research workbook and ZIP links point to that chat's sandbox. No PUBMAXX-named downloaded atlas or source pack was found by this filename scan. GitHub preservation of those cloud artifacts is unverified. The chat also gives SEO and scraping-provider advice, which is not evidence of implemented pages or provider migration. |
| Harness/skill maintenance | Historical chat reports updates applied but repository verification blocked and nothing pushed or deployed. This audit did not re-audit global tool versions. Current dependency/skill work belongs to its separately owned lane. |

## Local file and commit preservation

Sixteen checkouts were dirty at the inventory snapshot, including this audit's then-untracked evidence. Dirty entries are classified by use, not assumed to be product work:

| Class | Entries | Treatment |
| --- | ---: | --- |
| Source or developer documentation | 114 | Review and recover intent in the owning lane. |
| Proof under `docs/proof` | 119 | Review relevance and privacy before selecting evidence. |
| Private proof bundles | 2,160 | Keep local; do not bulk upload `.lavish`, traces or temporary handoffs. |
| Generated files and caches | 6,212 | Exclude from intentional commits. Includes 6,209 iOS build entries and three dependency symlinks. |
| Data/assets and audit metadata | 15 | Review individually. This count includes this audit's own early metadata files. |

Eleven of 114 changed source/docs files exactly match Git blob bytes reachable from live GitHub branches or available PR refs. The remaining 103 exact working versions did not match those available histories. Seventy-nine belong to active v0 integration; 24 are outside that lane. A byte match proves historical remote storage, not that the same path is current, tests pass, or the feature is deployed.

Of 52 checkout heads, 24 are ancestors of current main, 16 are preserved in other live remote branch history, and 12 lack ancestry proof from available branch or PR objects. Those 12 represent 11 distinct SHAs. Local object stores do not contain every advertised remote head, so negative ancestry results mean preservation is unproved, not proved impossible. Commit API lookups returned validation errors for those SHAs and provided no positive presence proof.

Across the two Git directories, 295 local branch refs were inventoried. After checking live branches and retained PR refs, 132 tips still lacked reachability proof from available remote objects. They include old local rewrites and backup branches; this count is not 132 missing features. Preserve them until commit and patch reconciliation decides whether they carry unique work.

## Safe recovery priorities

1. Preserve active `v0-integration` work with its current owner. Let that owner finish performance/CWV checks and choose its final diff and shipment. Do not stage the whole checkout or run overlapping repair work against it.
2. Reconcile older source edits that have no exact remote-byte match: 16 harvest-caller repair files, two dependency-tooling files, one skip-link E2E file, one native-onboarding E2E file, three review-dedup prototype files and one product-audit document. Compare current main and the owning chat before recovering an obsolete patch.
3. Treat the old #1544 and tablet-banner worktrees as duplicate-preservation candidates. Their changed source bytes already exist remotely. #1646's five files also exist remotely despite its issue remaining open. Confirm current main behaviour before closing the issue or discarding local files.
4. Keep every local-only commit candidate and detached worktree until reconciled. Read-only discovery did not prune stale records, delete branches, archive worktrees or reset files.
5. Select small proof excerpts that explain a verified change. Keep private trace bundles, browser state, arbitrary downloaded files and generated native builds outside GitHub.
6. Treat deployment of #1869/current main as unfinished. Production currently serves the prior head. A new deployment requires the captain's release decision and a READY result, followed by live checks.
7. Recover the cloud research pack explicitly if the user wants it preserved. The current audit establishes neither a downloaded copy nor a GitHub copy.

## Standalone PUBMAXX folders

Fourteen matched folder roots outside embedded Git checkouts contain 486 files, totalling 70,794,785 bytes. Eighteen regular-file byte versions match available live GitHub branch or PR history. Preservation of the remaining exact versions is unproved. These folders mostly contain operational proof rather than product source.

| Folder label | Files | Exact byte matches in available GitHub history |
| --- | ---: | ---: |
| `pubmaxx-reconciliation` parent metadata | 1 | 1 |
| Treehouse PUBMAXX parent metadata | 3 | 1 |
| `pubmaxx-cheap-pint-race-proof` | 5 | 1 |
| `pubmaxx-deps-minor-validation` | 159 | 0 |
| `pubmaxx-gnhf-worktrees` | 0 | 0 |
| `pubmaxx-heritage-date-proof` | 5 | 0 |
| `pubmaxx-map-recovery-proof` | 38 | 2 |
| `pubmaxx-map-shields-proof` | 11 | 1 |
| `pubmaxx-pubs-card-layout-proof` | 4 | 1 |
| `pubmaxx-pubs-images-evidence` | 120 | 3 |
| `pubmaxx-review-closeout` | 109 | 4 |
| `pubmaxx-store-parity-proof` | 3 | 1 |
| `pubmaxx-uuid-advisory-proof` | 17 | 3 |
| `pubmaxx-uuid-repair-proof` | 11 | 0 |

The full local manifest records each pathname, size, hash where safe, and preservation result. Folder or filename matching can miss renamed PUBMAXX material. Dependency/build caches and Git metadata were excluded; symlinked directories were not traversed. No conclusion covers arbitrary unlabelled files elsewhere on the machine.

## What this audit does not claim

No fresh product tests or builds ran during snapshot collection. No gate, CI, migration, location grant, deployment of latest main, app-store release or global harness update is declared complete merely from a historical chat. No private chat exports or folder bundles were uploaded. Publication of the reviewed reports remains separate from preserving their private local evidence.

## Reviewed preservation prepared after collection

The [selected source manifest](../source-preservation-20260929/README.md) records outcomes for all 24 older source and document candidates. Its archive retains 21 exact working source versions: 16 harvest files, two E2E files and three review-prototype files. Every archived entry was compared with its inspected source and rehashed after creation. The ZIP is 77,486 bytes, SHA-256 `e6ba03d79d335aa2614e15fe861562eb2bdc5acb5a26b4ee7de4e717304d1c3b`.

Two old dependency files are superseded by the compatible maintenance lane. One dated product-audit document remains local because its acceptance claims and private proof links cannot serve as current release evidence. Active v0 source, standalone proof folders and unproved detached refs remain with their current owners or in their existing local checkouts.

This is selected historical source retention, not runtime recovery. The old harvest patch depends on unmerged transport changes and refuses to apply to current main. No historical crawler ran. No source archive is remotely preserved until the publication gate returns a confirmed branch or PR; that receipt remains pending.
