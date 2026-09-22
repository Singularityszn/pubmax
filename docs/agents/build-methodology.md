# Build methodology

Every task moves through the same four beats, from Michael Shimeles' Rasmic template, adapted to this
tree. A beat never overrides a law in the root [AGENTS.md](../../AGENTS.md).

## The four beats

1. **Isolate with `/new-feature`.** Start every task in a fresh worktree and branch cut from
   `origin/main`. Keep an isolated worktree supplied by Codex, Treehouse or another harness.
   Give a detached checkout its own task branch before committing. Never build on `main`.
2. **Build with `/code-structure`.** Actions and boundaries orchestrate the why and when; a service layer
   owns the reusable how, with explicit inputs and structured returns. Here that is the policy-leaf shape
   [`lib/AGENTS.md`](../../lib/AGENTS.md) fences: one owner per rule, closed vocabularies, thin routes over
   the one API envelope [`app/AGENTS.md`](../../app/AGENTS.md) names.
3. **Prove with `/evidence-driven-testing`.** Run the repo's checks plus runtime evidence. Capture the
   BEFORE state while the issue reproduces, before the fix, when it is cheapest, and the AFTER state once
   it works. Evidence lanes: `npm run verify`, `npm run e2e:cli` for shots and snapshots, `docs/proof/`.
4. **Ship with `/before-and-after`, then `/greploop` or `/greploop-apps`.** Validate with no-mistakes
   on the final head. That run comes before any push and before the PR. Open the PR with
   before/after proof in the body, a screenshot or video for a visible surface, measured numbers or
   output pairs otherwise. Then run `/greploop` on the opened PR, or `/greploop-apps` past Greptile's
   file-count limit, until Greptile reports 5/5 with zero unresolved comments. Every greploop fix cycle
   commits and then pushes through the gate, so the PR head is always a gate-validated head.

## Writing for humans

Run `/unslop` over anything a person will read, before you commit, post or send it: commit messages, the
PR title and body, README and doc edits, code comments, the closing reply. It strips AI tells, swaps
fancy words for plain ones and passive voice for active. Apply it to text you wrote or changed, not to
prose you did not touch.

## Multi-agent rules

- Never commit directly to `main`.
- One worktree and one branch per task and per agent. Never reuse or modify another agent's worktree,
  branch or uncommitted work.
- **Scope check before starting.** Skim open PRs' changed files (`gh pr list`,
  `gh pr diff <n> --name-only`) and look for uncommitted work in shared checkouts. On overlap, stop and
  ask for direction.
- Never plain `--force` anywhere. Only `--force-with-lease`, and only on your own task branch.
- Resolve lockfile conflicts by regenerating, never by hand-merging.
- Worktrees do not isolate shared resources: confirm a dev-server port answers your own process, never
  run schema experiments against a shared database, and mind the shared `.next` clobber in the root
  AGENTS.md "Working in this tree".
- If a conflict cannot be resolved confidently, stop and report instead of guessing.

## Completing a task

1. Keep the changes limited to the assigned task.
2. Run the checks that `package.json` and `README.md` name. `npm run verify` is the merge bar. Hard
   invariants: the root laws plus the fences in [`lib/AGENTS.md`](../../lib/AGENTS.md) and
   [`supabase/AGENTS.md`](../../supabase/AGENTS.md). The Playwright server is in
   [`e2e/AGENTS.md`](../../e2e/AGENTS.md) and the PostgreSQL harness is in
   [`__tests__/AGENTS.md`](../../__tests__/AGENTS.md).
3. Assemble the evidence captured along the way into before/after pairs.
4. Commit with a clear message, rebase onto the latest `origin/main`, and rerun the checks.
5. Run the no-mistakes validation on the final head. The validation owns the push. In this fleet, the
   pipeline push step is the only push. For work outside the fleet, start the gate with
   `git push no-mistakes <branch>`. Never push to `origin` directly.
6. Open the PR. The body explains what changed, how it was tested, the before/after proof, and the risks
   and follow-up work.
7. Run `/greploop` or `/greploop-apps` until Greptile reports 5/5 with zero unresolved comments, then
   present the PR URL. In this repo, each fix cycle commits and then pushes with
   `git push no-mistakes <branch>` or a fresh `no-mistakes axi run`, never a plain `git push`. That
   command replaces the default push step of the greploop skill.

A merge happens only on the captain's word. Keep the worktree until the PR is merged or closed.

## Skill sources

The [skill index](../../SKILLS.md) maps work to focused playbooks. An agent
without a playbook follows the beats above by hand and reports the missing skill.
Install only the named skills needed for the task. Do not install an entire pack
to recover one missing entry.

| Skill | Install |
| --- | --- |
| `new-feature`, `code-structure`, `evidence-driven-testing`, `before-and-after`, `greploop-apps`, `unslop` | Repeat `npx skills add michaelshimeles/skills --skill <name> --agent <agent> -y` for each needed skill and agent |
| `greploop` | `npx skills add greptileai/skills@greploop` |
