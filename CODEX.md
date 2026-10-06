# CODEX.md: PubMaxxing handoff, 22 Sep 2026 07:30 UTC

For the Codex session the captain drives in the Codex app. The firstmate fleet (Claude Fable 5.1 session plus Cursor crew lanes) is PAUSED as of 07:25 UTC on the captain's word; nothing in the fleet will touch the repo until he restarts it. Everything below is verifiable in the repo, on GitHub, or in `/Users/karanmanoharan/karan-agent-workspace` (`$FM_HOME`). Read the root `AGENTS.md` and the area `AGENTS.md` nearest any file you edit.

## 1. State right now

| Thing | Value |
| --- | --- |
| Production | `42685ce22`, deployed 06:46 UTC 22 Sep (first deploy since 20 Sep), Vercel project `chengdu`, team `pubmax69`, `https://pubmaxxing.com/api/version` |
| Main | `3c8823bb7` (`feat(harvest): site-harvest drink labels for subtype-priced views (#1755)`), two merges past production: #1751 desktop polish, #1755 drink labels |
| Demo | Claude event, morning of 23 Sep; the feature is `/soft-drinks-and-water` (Coke Zero, Diet Coke, still water); PR #1764 widens it to a zero-sugar cola family chip for Lucia (captain's word: implement it; no rename to "Lucia special" until he says so) |
| Deploy rule | the captain's word only; recipe in section 6 |
| Fleet | paused; worktrees kept under `~/.treehouse/pubmaxx-bde241/<slot>/pubmaxx`; resume notes in section 7 |

## 2. Log of what the firstmate implemented (21 to 22 Sep)

Merged PRs, in merge order: #1727 #1728 #1722 #1729 (21 Sep night, map retry lane, deps), #1735 #1732 #1730 #1731 #1734 #1736 #1733 (TypeSafe judgment in ask, concierge, same-pub normalisers; map hang guard; knip scoping; one pint reader), #1746 (Dependabot bumps), #1737 (cleared the pre-existing production e2e reds; FIT gate at `76d2e88f3`), #1752 (soft drinks and water view), #1753 (Greene King rendered menus, L1), #1749 (outer London independents), #1748 (Greater London document crawl, L3), #1750 (GK Tavily Extract transport, L2), #1754 (bundle `drinkLabel` and `drinkSubtype`), #1760 (unused export, deadcode gate), #1761 (city slim shards restamped `local`), #1762 (54 historical docs removed), #1757 (Nicholson's soft-drink menus, first chain harvest), #1751 (desktop design polish 1440/1920), #1755 (site-harvest drink labels).

Data: London pubs with any drink listed went from 79 to 123 (document crawl); the UK price bundle has ~3,600 rows with labels; London soft-drink counts after #1755: Coke Zero 0, Diet Coke 1, still water 1 (Nicholson's pours Pepsi), which is why #1764 adds Pepsi Max and Diet Pepsi and a family chip (65 London pubs).

Tooling and fixes outside the repo: `data/tools/fm-review-lane.sh <pr>` (review lane generator), `fm-watch-long.sh` (long-cadence watcher), `pubmax-e2e-env.sh` (Playwright webServer env mirror, now with the rate-limit allowance), Grok-to-Cursor failover, the verify mutex, the Astra skill (`~/.agents/skills/astra`, also in `~/.codex/skills/astra`) with Jev model routing, the machine setup repo `karanmrn/karan-machine-setup` (private) with harness, skill and config manifests plus `snapshot.sh`, Hack Nerd Font installed, OpenCode's OpenRouter key refreshed, skills relinked into every harness (Pi, Grok, OpenCode, Cursor, Hermes), 83 old `~/Documents/projects/pubmaxx-*` clones removed (112 GB) after pushing their commits to `refs/heads/archive/<branch>`.

## 3. Open pull requests: what each needs

Fleet PRs (Cursor-authored, squash-merge with a hand-written message because their commits carry `Co-authored-by: Cursor`):

| PR | Head | State | Next step |
| --- | --- | --- | --- |
| #1764 Zero-sugar cola family chip | `203acfed4` MERGEABLE | ship lane's own gates green (verify under the mutex, soft-drinks spec 2/2); review lane paused after four inbox hold messages from a "Luna corrective lane" (not the firstmate) about Nicholson rows, trailers and concurrent verify | Decide with the captain whether #1774 (your "remove refused menu prices") supersedes the Nicholson data; if the captain's 21 Sep override stands, run a clean verify under the mutex, browser gate `e2e/soft-drinks-water.spec.ts`, merge. Review file: `$FM_HOME/data/checkpoints/2026-09-20-scratch/reviews/pr-1764.md` |
| #1747 London Tavily enrichment | `3a53c21c6` (rebased on main this morning, bundle rebuilt) | earlier verdict merge at `5e60af0eb`; verify not rerun since the rebase; slot 12 worktree clean apart from a pid file | Verify under the mutex in a clean shell (no e2e env), browser gate price specs + smoke on port 4247, merge |
| #1756 Reddit London prices | `43a53d477` CONFLICTING | review never started; slot 14 worktree holds a diverged unpushed commit `16b20d235` (GitHub is the truth; discard the local one) | Rebase-and-regenerate, review (standards, spec, verdict), verify, merge; then the wide Reddit run the captain wants (every London drink-price mention) |
| #1741 cheapestPint relabel fix | `89f4fd732` | the captain's own fix; review lane relaunched then paused | Rebase, verify under the mutex, merge |

Your own drafts (#1763, #1765 to #1774) are yours; the fleet has not touched them. Note #1774 removes the Nicholson menu prices that #1757 landed and #1764 builds on; the captain ruled on 21 Sep that chain menu pages may be fetched under his override with `robotsDisallowed: true` kept on each row, so get his word before merging #1774. #1759 (Playwright-only exports) should be checked against #1760, which already removed the knip finding.

## 4. Known reds on main (do not charge them to a PR)

- `e2e/price-colour-law.spec.ts:87`, `:104`, `e2e/trust-read.spec.ts:140` (x4), `e2e/overview-price-door.spec.ts:152` (x5), `:183`, `:211`: fixture venue `venue-1vle947` (The Sir Christopher Hatton) gained 73 labelled rows through #1754; the sheet renders, the seeded trust chip and door state no longer match. Task `pubmax-sheet-state-fixture-venue`: move the specs to a venue with no harvested rows, or decide trust precedence when community and harvested rows coexist.
- `e2e/mobile-button-system.spec.ts:386` flaky under load; `e2e/ui-consistency-layout.spec.ts:963` pre-existing (fails on the 20 Sep production too).
- `check:freshness` red on `area_news` only; tolerated.
- Gate report with the evidence: `$FM_HOME/data/checkpoints/2026-09-20-scratch/e2e-final-42685ce22.md`.

## 5. Laws and recipes that bite

- `npm run verify` locally is the merge bar (GitHub Actions is billing-locked). One verify at a time on this Mac: `until mkdir /tmp/pubmax-verify.lock 2>/dev/null; do sleep 30; done`, write `<pid> <time> <who>` into `/tmp/pubmax-verify.lock/owner`, `--maxWorkers=1`, `rm -rf /tmp/pubmax-verify.lock` in a trap. An owner whose pid is dead or older than 45 minutes is stale; remove it. Your Codex app ran `vitest --coverage` in `~/.codex/worktrees/*` without the lock this morning and exhausted the shared-memory pool.
- Shared memory: `kern.sysv.shmmni=32`. The Postgres harness now reaps its own orphaned `pubmax-(pg|rls)-*` clusters and their segments before the first slot claim; see "SysV segments are host state" in `__tests__/AGENTS.md`.
- Browser gates: `. $FM_HOME/data/tools/pubmax-e2e-env.sh && NEXT_DIST_DIR=.next-e2e npm run build && NEXT_DIST_DIR=.next-e2e nohup npm run start -- --port N &`, `/api/version` must report your head sha, then `PW_PORT=N PW_SKIP_WEBSERVER=1 PW_SKIP_KEYLESS_WEBSERVER=1 PW_KEYLESS_PORT=N npx playwright test <specs> --workers=1 --project=chromium`. One runner per server (two runners share the in-memory store and pollute each other). Never source that env file into the shell that runs `npm run verify` (43 rate-limit tests go red). Never `playwright install`; Chromium 1234 lives in `~/Library/Caches/ms-playwright`. Per-PR port `4200 + (pr % 100)`. Never kill servers you did not start.
- Data PRs: every merge regenerates `public/data/uk_prices/{manifest,rows}.json`. Rebase on `origin/main`, take theirs for the generated files, union `data/uk_prices/site_harvest.jsonl`, `npm run build:uk-price-bundle && npm run validate-data`, dedupe by `ukPriceBundleCollectKey`, `--force-with-lease`. Commit `public/data/cities/*` only with `revision: "local"` (`DEPLOYMENT_VERSION=local` when building shards), or `noMistakesTestCommand.test.ts` goes red.
- Commits: no agent trailer, no session link. Never force-push except `--force-with-lease` on your own branch. Never read `.env` or `.env.local`; keys live only in `$FM_HOME/data/keys.env` (mode 600), loaded in a subshell `( set -a; . $FM_HOME/data/keys.env; set +a; <cmd> )`, never printed.
- Merges after review, deploys, migrations and production env changes are the captain's call. Product name PubMaxxing (two x). Plain dash, never an em dash.

## 6. Deploy (captain's word only)

```sh
git clone --depth 1 https://github.com/Singularityszn/pubmax /tmp/pubmax-deploy && cd /tmp/pubmax-deploy
npx -y vercel@latest link --yes --project chengdu --scope pubmax69
npx -y vercel@latest deploy --prod --yes
curl -s https://pubmaxxing.com/api/version
```

`/tmp/pubmax-deploy` already exists, linked, at `42685ce22`; `git fetch --depth 1 origin main && git reset --hard origin/main` before deploying again.

## 7. The paused fleet, if the captain restarts it

- Lanes and slots: review-1764 slot 9, review-1747 slot 12, review-1755 slot 10 (PR merged, slot can be torn down), review-1756 slot 11, review-1741 slot 16, reddit ship slot 14, harvest soft-drinks-menus-2 slot 6 (now on your `codex/soft-drinks-harvest-correction-20260922` branch with uncommitted test edits; its `fm/pubmax-harvest-soft-drinks-menus-2` branch is still in that slot; commit or discard before the pool reclaims it).
- Resume: `cd $FM_HOME && bin/fm-control.sh <lane> relaunch --harness cursor --model composer-2.5 --effort xhigh --note "<progress>"`; re-arm the watcher with `data/tools/fm-watch-long.sh`; drain wakes with `bin/fm-wake-drain.sh`. Tear down a merged lane with `bin/fm-teardown.sh <lane>` after `git checkout -- public/data docs/proof` (`next-env.d.ts` is ignored).
- Captain calls still open in the backlog (`tasks-axi list`): vendored skill trees out of the product repo (`skills/` has no tracked files, `docs/superpowers`, `.firecrawl/design-skills`), unnamed OSM pubs on the UK map, UK seed refresh, phone compass, map tile CDN, landing primary, plus the older 5 Sep review calls.
- Standing captain rulings live in `$FM_HOME/data/captain.md`; the session timeline in `$FM_HOME/data/checkpoints/2026-09-16-codex-handover.md`; the earlier detailed handoff in `$FM_HOME/data/checkpoints/2026-09-22-codex-handoff.md`; the machine snapshot repo `https://github.com/karanmrn/karan-machine-setup`.

## 8. Not done, in priority order

1. Land #1764 (Lucia feature) once the Nicholson-data question is settled with the captain.
2. Land #1747, #1741, #1756; then the wide Reddit harvest.
3. Fix the 13 fixture-venue reds (section 4) so main is green end to end.
4. Soft-drink coverage beyond Nicholson's: the paused harvest lane's target chains were Wetherspoon, Stonegate (Slug and Lettuce), Greene King, BrewDog, Young's; URL lists are in slot 6 as `data/soft_drinks_*_london_urls.txt`.
5. Captain's own items: Search Console, GitHub Actions billing, PostHog key rotation, `KEENABLE_API_KEY` for area_news, OpenCode Zen re-login, omp's openrouter default (401).
