# Thermo-Nuclear Repository Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven development for independent review lanes and executing-plans for verified repairs. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review every active PUBMAXX change against `origin/main`, recover only valid unmerged work, fix verified defects, and integrate a release-safe result without reviving stale branches.

**Architecture:** Treat `origin/main` as fixed point. Classify every ref before code review, then review active diffs on separate Standards, Spec, security/correctness, and maintainability axes. Apply repairs in the candidate owner's clean worktree with failing tests first, then re-review the exact pushed SHA here. Merge only branches with current intent, non-duplicated patches, and green verification.

**Tech Stack:** Git, GitHub, Next.js 16, React 19, TypeScript, Vitest, Playwright, Capacitor 8, Supabase migrations.

**Spec:** `CONTEXT.md`, `AGENTS.md`, `docs/CURRENT_CONTEXT_2026-08-27.md`, `docs/VOICE.md`, branch commit messages, matching plans under `docs/superpowers/plans/`, and linked GitHub issues where available.

## Global Constraints

- Preserve `/Users/karanmanoharan/Documents/pubmax` and every dirty path in it.
- Use `origin/main` as fixed point and three-dot diffs against each candidate branch.
- Do not merge archive, backup, generated-data, or superseded branches only because their tips are not ancestors of `main`.
- Do not change production data, deploy Vercel, build signed native artefacts, or submit stores before shared release checkpoint.
- Run heavy gates serially on this 8 GiB Mac and check free disk first.
- Never commit secrets, generated changelog edits, or local Next.js tooling churn.

---

### Task 1: Branch and merge classification

**Files:**
- Create: `docs/proof/thermonuclear-review/branch-inventory.md`

**Interfaces:**
- Consumes: all local branches, `refs/remotes/origin/**`, GitHub PR state, active worktree ledger.
- Produces: one row per branch with owner, tip, date, PR state, merge-base, unique patch status, and disposition.

- [x] **Step 1: Refresh refs without deleting any branch**

```sh
git fetch --all --tags
```

- [x] **Step 2: Record fixed point and active PRs**

```sh
git rev-parse origin/main
gh-axi pr list --state open --limit 100
git worktree list --porcelain
```

- [x] **Step 3: Classify every branch**

For each ref, record `merged`, `open-pr`, `active-worktree`, `patch-equivalent`, `superseded`, `generated`, `archive`, or `needs-review`. A branch may enter review only when its disposition is `open-pr`, `active-worktree`, or `needs-review` with current product intent.

- [x] **Step 4: Verify inventory completeness**

Compare inventory row count with local and remote ref counts. Fail when any ref has no disposition.

- [ ] **Step 5: Commit inventory**

```sh
git add docs/proof/thermonuclear-review/branch-inventory.md
git commit -m "docs(review): classify repository branches"
```

### Task 2: Parallel review axes

**Files:**
- Create: `docs/proof/thermonuclear-review/findings.md`

**Interfaces:**
- Consumes: candidate list from Task 1 and `git diff origin/main...<candidate>`.
- Produces: evidence-backed findings separated into Standards, Spec, security/correctness, and maintainability.

- [x] **Step 1: Run Standards review**

Review documented rules plus Fowler smell baseline. Cite file and line for every finding.

- [x] **Step 2: Run Spec review**

Trace commit references to issues or plans. Report missing requirements, scope creep, and wrong implementations. Mark branches with no recoverable spec.

- [x] **Step 3: Run security and correctness review**

Trace changed inputs through auth, storage, API, migration, rendering, feature-gate, and failure boundaries. Report only issues introduced or modified by candidate diffs.

- [x] **Step 4: Run maintainability review**

Measure file growth, files over 1000 lines, duplicated conditions, optional or cast-heavy boundaries, non-atomic updates, and feature logic in shared paths. Prefer simplifications that delete complexity.

- [x] **Step 5: Aggregate without hiding review axes**

Keep Standards and Spec reports separate. Add severity, confidence, reproduction path, affected branch, and proposed test for security and maintainability findings.

### Task 3: Test-driven repairs

**Files:**
- Modify: exact production and test files named by accepted findings only.

**Interfaces:**
- Consumes: accepted findings from Task 2.
- Produces: one small repair commit per independently testable defect.

- [ ] **Step 1: Reproduce each defect**

Use the narrowest real-user path available. Record the failing command and observed result.

- [ ] **Step 2: Add one failing regression test**

Run the exact test and confirm failure is caused by the reviewed defect.

- [ ] **Step 3: Implement minimal structural fix**

Keep policy in its canonical module. Delete duplicated branches or wrappers when that is the simpler fix.

- [ ] **Step 4: Run focused tests, lint, and typecheck**

```sh
npx vitest run <exact-test-file>
npx eslint <changed-source-and-test-files>
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit repair**

```sh
git add <exact-reviewed-files>
git commit -m "fix(<scope>): <verified defect>"
```

### Task 4: Controlled integration

**Files:**
- Modify: branch history only after candidate acceptance.
- Create: `docs/proof/thermonuclear-review/integration-ledger.md`

**Interfaces:**
- Consumes: clean repair branch and accepted candidate commits.
- Produces: one reproducible integration sequence with no duplicate patches.

- [ ] **Step 1: Recheck candidate overlap**

```sh
git range-diff origin/main...<candidate-a> origin/main...<candidate-b>
git cherry origin/main <candidate>
```

- [ ] **Step 2: Integrate one candidate at a time**

Use the merge or cherry-pick form recorded in the ledger. Stop on conflict and resolve from current contracts, never by taking one side wholesale.

- [ ] **Step 3: Run candidate-focused gates**

Run changed-feature tests, lint, typecheck, data validation, and `git diff --check` after each integration.

- [ ] **Step 4: Record exact SHAs and rejected branches**

For every candidate, record source tip, incorporated commits, superseding commit when rejected, tests, and remaining external blockers.

### Task 5: Full verification and release decision

**Files:**
- Update: `docs/proof/thermonuclear-review/integration-ledger.md`

**Interfaces:**
- Consumes: final integrated commit.
- Produces: verified merge candidate or explicit blocked result.

- [ ] **Step 1: Check resources and stop concurrent builds**

```sh
df -h .
vm_stat
pgrep -fl 'next|vitest|tsc|gradle|xcodebuild'
```

- [ ] **Step 2: Run serial repository gates**

```sh
npm run validate-data
npm run lint
npm run typecheck
npm test
npm run coverage
NEXT_DIST_DIR=.next-prod npm run build
git diff --check
```

- [ ] **Step 3: Run browser and native gates where toolchains exist**

Run mobile and desktop browser journeys. Run Capacitor sync, doctor, native tests, simulator compile, and device checks only when required toolchains and release checkpoint exist.

- [ ] **Step 4: Perform final diff review**

Review shape, diff, docs, security boundaries, and release evidence before any merge or push.

- [ ] **Step 5: Push reviewed branch**

Push only after all available gates pass. Opening or merging a PR remains a separate explicit release action when protected checks or human gates are unresolved.
