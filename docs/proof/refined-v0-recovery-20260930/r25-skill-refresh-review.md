# R25 skill freshness and provenance review

Audit: 2026-09-30 12:47 UTC. Read-only. No skills installed or overwritten; no repository files changed.

## Evidence

`~/.agents/.skill-lock.json` is v3 with 108 entries, 107 locally marked updated on 2026-09-30. It stores source URL, skill path, folder hash and local timestamps, but no upstream commit or ref. `updatedAt` alone does not prove freshness.

I compared six lock-tracked requested skills with their public GitHub default-branch `main` files at audit time. Global `~/.agents/skills` bytes matched exactly: GNHF (`kunchenguid/gnhf`), diagnosing-bugs, tdd and code-review (`mattpocock/skills`), unslop (`backnotprop/pstack`), and verification-before-completion (`obra/superpowers`). The source links and blob hashes are in the companion JSON. This confirms those shared files at the checked revisions, not active repo overlays.

Project instructions prefer `.agents/skills/`, so five repo copies shadow current shared versions:

| Skill | Project copy delta | Disposition |
| --- | --- | --- |
| `gnhf` | Replaces upstream `--model` advice with a no-unsupported-flags warning; narrows process matching. | Preserve CLI-specific overlay. Its `../../README.md#agents` link resolves to absent `.agents/README.md` from this checkout; investigate packaging/link target if editing. |
| `diagnosing-bugs` | Points to `CONTEXT.md`, adds post-mortem/architecture follow-up; punctuation edits include em dashes. | Preserve semantic additions; normalize punctuation per root AGENTS if touched. `CONTEXT.md` and `docs/adr/` exist. |
| `tdd` | Narrows invocation, disables automatic model invocation, allows closest practical verification when a test is not viable. | Preserve project policy. Resolve overlap with `test-driven-development` before routing changes. |
| `unslop` | Adds human-voice guidance; removes upstream `disable-model-invocation: true` while saying “Must always apply.” | Keep content; owner should explicitly confirm intended auto-invocation. |
| `code-review` | Mostly wording and punctuation; local file contains em dashes and changes missing-setup guidance. | Preserve intentional behavior; normalize punctuation. Its `docs/agents/issue-tracker.md` reference exists. |

## Catalog and repository-only skills

`docs/agents/INSTALLED_SKILLS.md` labels itself generated on 2026-08-07. It records source-repository labels for `test-driven-development` (`kunchenguid/programbench-bench`), the three `audit-*` skills and `test-playwright` (`kensaurus/cursor-kenji`). This corrects the earlier draft: those origins are recorded. The catalog gives no commit/ref or content hash, so it is lineage evidence, not immutable upstream-version or current-freshness proof. The requested lock has no entry for these five skills.

`deslop` has a repo copy but no matching lock entry or source mapping in that catalog. `greploop` is absent from scanned repo/shared copies and the lock. `unslop` and `verification-before-completion` lack catalog entries but their lock records identify their source repositories; their shared copies were checked against current `main` above.

The local file-reference scan found:

- `test-driven-development` references `@testing-anti-patterns.md`; the companion exists at `.agents/skills/test-driven-development/testing-anti-patterns.md`. It does not reference `tests.md` or `mocking.md`; that earlier claim confused it with `tdd`.
- `audit-ux-journeys` references `references/checklist.md`, which exists.
- `test-playwright` points to the sibling `protocol-browser-anti-stall/references/` files; both named files exist. Its shorter line-36 shorthand `references/playwright-session-coordination.md` is not inside the skill folder, while the later explicit sibling path resolves.
- Other inspected local file references resolve or are conditional prose references. `gnhf` is the unresolved project-layout link noted above.

## Review findings

The substantive routing conflict remains: project `tdd` is selectively invoked and permits closest practical verification when tests are not viable, while `test-driven-development` says to use it for every feature or bugfix and “NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.” Resolve the policy overlap before changing invocation or refresh behavior. This is not a provenance gap: the dated catalog records the latter's source repository, without pinning a revision.

No whole-collection install or quarantine is justified. Preserve intentional overlays; separately review invocation/policy differences and pin exact source refs if a refresh is requested. Full hashes, copy paths, lock fields, catalog labels, reference results and remote blobs are in the companion JSON.
