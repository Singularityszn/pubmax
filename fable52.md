# fable52 - PUBMAXX handoff, 3 Sep 2026 (Fable 5.1 session close)

Written 3 Sep 2026 ~14:10 BST by Fable 5.1 (firstmate orchestrator). Continues `sol5g.md` (30 Aug to 3 Sep 00:20). Product: PUBMAXX at pubmaxxing.com. Repo: github.com/Singularityszn/pubmax. Fleet home: `~/karan-agent-workspace` (fork karanmrn/firstmate of kunchenguid/firstmate). Companion file: `setup.md` (rebuild this environment on a new Mac).

Everything below is on GitHub. Nothing lives only on this machine.

---

## 0. Production and repo state right now

- **Production**: Vercel project `chengdu` (team `pubmax69`), deployment `chengdu-3jh5gydp2`, main `ed7f570` (deployed 3 Sep 11:25). Carries everything merged up to and including #1328.
- **Merged after that deploy, UNDEPLOYED**: the six Codex PRs #1321 #1322 #1323 #1324 #1325 #1318 (section 2). One deploy word ships them: fresh shallow clone of main, write `.vercel/project.json` (`projectId prj_FAC09rdCxDiGujUHeDOeZ04JLymc`, `orgId team_ZHYOvhX8M0Gxyq4J3XOgOwmF`), `npx -y vercel@latest deploy --prod --yes --scope pubmax69`.
- **Supabase** (project `iankajxliutqogqkmvdg`): migrations 0123 to 0126, 0133, 0134, 0135 and **0136** (applied 3 Sep 11:55; both join and redeem account functions now carry `membership_revoked_at is null`) are live. 0127 to 0132 are ledger records only.
- **Open PRs**: zero. **Fleet**: empty; no worktrees; `~/.treehouse/pubmax-bde241` holds only pool state.
- **GitHub Actions is dead** (billing, since 2 Sep 02:19). On the captain's word ("checks off") `main` has NO required status checks and `enforce_admins` is OFF. Saved list to restore: `data/checkpoints/required-checks-2026-09-03.json` in the fleet home. Restore: `gh api -X PUT repos/Singularityszn/pubmax/branches/main/protection/required_status_checks --input <file>` then `gh api -X POST repos/Singularityszn/pubmax/branches/main/protection/enforce_admins`.
- **Merge bar while Actions is off**: local only - changed-file ESLint 0 errors, focused tests, full unit suite, `tsc` (scoped to changed files when the full run OOMs at the 2GB cap), and for any migration or RPC the effective PostgreSQL proof run alone. Counts recorded in the task status before merging.

## 1. Merged 3 Sep after sol5g.md (fleet lanes)

| PR | What it ships | Bar |
|---|---|---|
| [#1319](https://github.com/Singularityszn/pubmax/pull/1319) | One-shot password-creation prompt behind the shared prompt budget (two React render-purity errors fixed; the budget mock made faithful) | ESLint 0, focused 20/20, unit 13,207 |
| [#1327](https://github.com/Singularityszn/pubmax/pull/1327) | Voice-audit copy fixes across 16 surfaces; composed stale line "No fresh picks to show just now. Last checked {date}."; rendered fences that can fail; `now` fallback moved off the render path | ESLint 0/0 (33 files), fences 98/98, unit 13,229 |
| [#1328](https://github.com/Singularityszn/pubmax/pull/1328) | Migration 0136: revoked seats no longer block join or redeem; proven on real PostgreSQL (revoked join, revoked redeem, active refusal holds, rollback re-refuses) | 4/4 Postgres proofs, unit 13,229 |

Also merged today before these: #1310 sol5g.md, #1311 desktop voids, #1315 design follow-ups, #1316 E1 claim swap (pipeline PR), #1317 weather snapshot refresh.

## 2. The Codex PR review lane (3 Sep 12:20 to 14:00)

One reviewer worker (claude-opus-5 xhigh) took each open Codex-app PR through `/pstack`, `/code-review`, `/thermo-nuclear-review` and `/codebase-design`, fixed in-intent findings, ran the local bar, and firstmate pushed and merged on the evidence. Review notes with file:line evidence: fleet home `data/codex-pr-review/<number>.md`.

| PR | Verdict and what changed under review |
|---|---|
| [#1321](https://github.com/Singularityszn/pubmax/pull/1321) price freshness | Merge. Split the drinker-facing authority window (bundled price older than 720h shows as an estimate, "Last seen 3 Jul 2026") from the release-gate dataset budget (stays 2160h so the gate fails only on real neglect). Re-collection of `pint_prices` (1487h old) filed as an issue |
| [#1322](https://github.com/Singularityszn/pubmax/pull/1322) migration label fence | Merge. Test and docs only; pins the 12 historical duplicate labels; proven to fail on a reused label. Reservations shifted to 0137 to 0139 |
| [#1324](https://github.com/Singularityszn/pubmax/pull/1324) auth callback cleanup | Merge. Callback credentials leave the address bar before any deployment-skew reload; proven not to deadlock; two brittle source-regex tests replaced with behavioural ones |
| [#1323](https://github.com/Singularityszn/pubmax/pull/1323) auth bootstrap await | Merge. A missing resume cookie no longer publishes signed-out while the local session read is in flight; 3 new tests fail on old main, pass on branch; accepted cost documented (anonymous slow read waits, bounded by the 20s ceiling) |
| [#1325](https://github.com/Singularityszn/pubmax/pull/1325) plan account-blind fallback | Merge. Signed-in join and redeem stop as retryable 503 when their account RPC is missing instead of retrying account-blind (old fallback could mint a second seat). Complementary to 0136 |
| [#1318](https://github.com/Singularityszn/pubmax/pull/1318) WebMCP challenge page | Merge after one ruling. Clean on every safety axis (no bot or CAPTCHA bypass, no new dependency, no secrets, no new network surface, trust boundaries hold). Fixed 10 type errors and a surface-read fence failure Codex missed. **A root MIT LICENSE file was dropped from the PR**: it would have open-sourced the whole private product; the challenge's public snapshot repo already carries its own licence. `/webmcp` got robots index:false and a route budget |

## 3. Rulings made today (keep them)

- Preferred city is the single Map destination everywhere; `/map` root stays London for bookmarks.
- Event source links must be a real route; a publisher front door with a tracking parameter is never a source.
- Anonymous check-in and anonymous Wanted saves stay allowed. An action that names an account aborts on account rotation; an action carrying no identity completes as anonymous and never inherits the arriving account (`requiresIdentity` on the queued action).
- Admin retry never claims to mint a session; a 403 followed by an anonymous probe is "session expired", an unknown probe stays "we could not tell"; the mint-capable re-auth boundary is banked as an issue.
- Performance gate policy (one breaching sample fails) is NOT loosened inside a feature PR. The gate is noisy on the CI runner (main passed and failed on identical code); the policy question is filed for the captain.
- A migration PR must carry its effective PostgreSQL proof by name before merge.
- A root licence file never rides in a feature PR.

## 4. Operational faults found and fixed today

- **Orphaned Postgres test clusters** (`pubmax-rls-*` under `/var/folders/.../T`) from hook-timed-out RLS tests held all 32 macOS shared-memory segments, so every DB-backed test failed to start for hours and was misread as "environment". Fix: `pg_ctl -D <tmpdir> stop -m fast` each orphan, then `ipcrm -m <id>` for segments whose creator pid is dead. Check `ipcs -m | grep -c '^m '` before blaming disk or memory.
- **Watcher arm confirmation timeout** (10s) under load killed every Stop-hook watcher for hours; `export FM_ARM_CONFIRM_TIMEOUT=60` now lives in `~/.zshrc` (the earlier fix in `config/x-mode.env` was wiped by bootstrap because Relay is off).
- **Weather snapshot freshness**: `public/data/weather/latest.json` crossing 48h fails every PR's release gate; `npm run refresh:weather` as a one-file chore commit fixes it (#1317).
- **bin/fm-teardown.sh** cannot return worktrees on this home (`cd: pubmax`): use `(cd projects/pubmax && treehouse return --force <dir> && treehouse prune --yes)` for pool slots, `git worktree remove --force` for ad-hoc worktrees, then archive `state/<id>.*` under `state/.retired/`.
- Memory: two lanes plus the captain's Codex app push swap to 8 to 11GB on the 8GB Mac; run one heavy lane while the Codex app is open. A nine-commit branch cost 11 hours of review; one-commit branches cost about an hour. Split before validating.
- The worker's permission classifier blocks force pushes; firstmate pushes reviewed heads from the worktree with `--force-with-lease`.

## 5. Open for the captain

1. **Deploy** the six Codex merges (one word).
2. Restore branch protection when GitHub Actions billing is fixed (command in section 0).
3. Re-collect the bundled `pint_prices` dataset (1487h old; issue filed by the review lane).
4. Perf-gate noise on CI: one-sample vs two-consecutive-samples policy (issue filed).
5. UK price harvest and trust policy; authenticated e2e lane; Clerk adopt or cancel; night-streaks shape; discard word for the dirty `projects/pubmax` clone (skill-installer churn only); Stripe keys; Skiddle approval.

## 6. Remaining queue (not promised)

`fm/grokbot-audit-fixes-v2` (18 commits on origin; split into three PRs: copy fixes, event-source honesty, account-boundary rule, with section 3 rulings), `fm/agents-md-trim` (law-by-law re-entry behind the #1305 fence), Pal species fox, pigeon, badger, corgi (ElevenLabs flow `I9rZih8pT1Z63EYwBSJF`, robin reference node `TQLw0dtKg7IAqPBs1GWO`), issues #1306 #1294 #1298 #1299 #1300 #1326 #1314. Stash@{0} in `projects/pubmax` is the `fm/map-bundle-diet` WIP: keep. Feature plan tiers 1 to 4 are in `sol5g.md` section 8.

## 7. The day in one paragraph

Finished the small-branch train (#1319, #1327), found and fixed a live production bug in migration 0134 (#1328, applied as 0136), deployed twice, then reviewed and merged all six Codex-app PRs through four review skills on a local test bar after GitHub Actions billing died, catching a licence file that would have open-sourced the product. Along the way: unblocked every Postgres-backed test by clearing orphaned test databases, fixed the watcher's start-up window, refreshed the weather snapshot, tore down every finished worktree, and wrote `sol5g.md`, this file, and `setup.md`.
