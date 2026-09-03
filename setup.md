# setup.md - rebuild the PUBMAXX agent fleet on a new Mac

Written 3 Sep 2026 from the working machine (Apple silicon, 8GB RAM). Target: the new Mac (24GB RAM, 18-core CPU, 20-core GPU, 1TB SSD). Versions are what ran today; newer is fine unless a step says otherwise. Every secret stays in your password manager: this file names where each one goes, never the value.

Follow the sections in order. Steps marked **you** need a human (logins, tokens, OAuth). Everything else an agent can run. Total time about 90 minutes, most of it waiting on installs and logins.

Companion files on main: `sol5g.md` (30 Aug to 3 Sep build log and feature plan), `fable52.md` (3 Sep close-out and open items).

---

## 0. What the fleet is

One orchestrator ("firstmate", Claude Fable 5.1 in Claude Code) runs in `~/karan-agent-workspace`, a fork of `kunchenguid/firstmate`. It never edits the product. It writes a brief per task, spawns a worker in an isolated git worktree inside a herdr tab, steers it through a durable inbox, and merges on evidence. Workers are any signed-in harness (Claude, Codex, Cursor, Grok, Pi, OpenCode). The product repo is `Singularityszn/pubmax`, deployed to Vercel project `chengdu`, backed by Supabase project `iankajxliutqogqkmvdg`. The captain (you) gives the word for merges outside standing `yolo`, for deploys, and for migrations.

## 1. Base tools (15 min)

```bash
xcode-select --install
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install gh jq zsh-syntax-highlighting postgresql@16 postgrest
gh auth login              # you: GitHub account karanmrn, HTTPS, browser flow

# Node via vite-plus (every agent CLI on the old Mac is installed through vp)
curl -fsSL https://vite.dev/plus/install.sh | sh
vp install node@24         # v24.20.0 on the old Mac
npm i -g pnpm@11
```

`~/.zshrc` additions:

```bash
export NODE_OPTIONS=--max-old-space-size=4096   # 24GB Mac; the old 8GB Mac ran 2048
# firstmate: watcher arm confirmation window; 10s default died under load (data/learnings.md 2026-09-03)
export FM_ARM_CONFIRM_TIMEOUT=60
```

System Settings, **you**: Energy > prevent automatic sleeping on power adapter (overnight agent runs die when the Mac sleeps); screensaver off; Aerial wallpaper off (both are standing captain rules, see `data/captain.md`).

## 2. Agent harnesses (10 min, each needs a login)

```bash
npm i -g @anthropic-ai/claude-code      # claude 2.1.259; first run: claude   (you: Anthropic login)
npm i -g @openai/codex                  # codex-cli 0.151.0; codex login     (you)
curl -fsSL https://cursor.com/install | sh        # cursor-agent 2026.08.31; cursor-agent login (you; Cursor Ultra)
npm i -g @vibe-kit/grok-cli             # grok 1.0.13; open `grok` once to mint its local token (you)
npm i -g @mariozechner/pi-coding-agent  # pi 0.84.3 (Anthropic and OpenRouter keys in its config)
npm i -g opencode-ai --allow-scripts=opencode-ai   # opencode 1.18.25 (OpenRouter key)
```

Also install the **Codex desktop app** (you). The captain runs feature work there in parallel with the fleet; the fleet reviews its PRs (section 9, "Codex PR review lane").

Claude Code plugins (`/plugin install <name>` inside claude): `ecc` (2.2.x; GateGuard fact-forcing hooks, strategic-compact), `compound-engineering` (3.24.x; ce-plan, lfg, ce-work, ce-code-review), `caveman`, `openai-codex`.

GateGuard behaviour to expect in every Claude session: the first Bash asks for two facts; a destructive command (rm, force push, reset) asks for three; the first Edit/Write of a file asks for four. State the facts in the reply and retry the same call. `GATEGUARD_BASH_ROUTINE_DISABLED=1` inside a command skips the routine gate. The auto-mode classifier blocks `kill`, `gh pr merge --admin`, branch-protection edits, `.claude/settings` edits and force pushes: the captain runs those as `! <cmd>` in the prompt.

## 3. herdr, treehouse, no-mistakes (10 min)

```bash
brew install kunchenguid/tap/herdr        # herdr 0.8.2
brew install kunchenguid/tap/treehouse    # treehouse v2.3.0
brew install kunchenguid/tap/no-mistakes  # no-mistakes v1.53.0 (v1.60.2 available; update in an idle window)
```

If the tap names differ, each tool lives under github.com/kunchenguid; follow its README.

### herdr setup

Copy `~/.config/herdr/config.toml` from the old Mac. What it sets:

- tmux-style prefix `ctrl+b`: `prefix+h/j/k/l` focus panes, `prefix+"` and `prefix+%` split, `prefix+c` new tab, `prefix+w` workspace picker, `prefix+g` goto, `prefix+y` copy mode.
- Agents sidebar sorted by space, agent labels on pane borders, scrollbars off, tab bar hidden when single tab, native host cursor. Rows show `state · agent · state text` / pane / workspace+tab. Harness colours: Claude blue, Codex red, Grok cyan, OpenCode green, Pi mauve, Kimi peach, Hermes teal.
- `[experimental] reveal_hidden_cursor_for_cjk_ime` for the `cursor` agent (Cursor's composer was invisible under herdr 0.8 chrome).
- Toasts delivered by herdr.

Plugin: **hunk** (`jhochenbaum/herdr-hunk-diff`) reviews agent-authored diffs in a split pane and sends inline comments back to the agent. Install from the herdr plugin picker; it builds with `npm ci && npm run build`.

Workspace layout the fleet expects:

| Workspace | Label | Purpose |
|---|---|---|
| w8 | `karan-agent-workspace` | firstmate's own pane (tab 1) plus one tab per live worker, labelled `<task-id>` |
| wB.. | `└ <task> · p:<pane>` | disposable per-task presentation spaces herdr creates when `config/herdr-presentation-spaces` is on (off on the old Mac) |
| wE | `◢ COMMAND DECK ◣` | nine-pane dashboard: fleet board, memory, disk, watcher log, PR list |

Skill file: `herdr --skill > ~/.claude/skills/herdr/SKILL.md`, then copy the same file to `~/.agents/skills/herdr/` and `~/.codex/skills/herdr/`. The commands firstmate uses: `herdr workspace list`, `herdr tab create --workspace w8 --cwd <worktree> --label <task>`, `herdr agent start <task> --kind claude --pane <pane> -- --model claude-opus-5`, `herdr agent prompt <pane> "<text>"`, `herdr pane read <pane>`, `herdr pane send-keys <pane> Enter`, `herdr tab close <tab>`.

### treehouse

`treehouse` keeps a pool of pre-created worktrees so a spawn does not wait on `npm ci`. From `projects/pubmax`: `treehouse init` once, `treehouse get --lease --lease-holder <task>` to take a slot, `treehouse return --force <dir>` and `treehouse prune --yes` to give it back. The pool lives at `~/.treehouse/pubmax-<hash>/<slot>/pubmax`. On the new Mac size the pool at 4 slots (`treehouse config` or the pool file), two on the old one.

### no-mistakes

The validation pipeline a worker drives from its worktree: `no-mistakes axi run` steps intent, rebase, review, test, document, lint, push, pr, ci; `no-mistakes axi status` shows the current step; the worker answers gates with `no-mistakes axi respond`. Firstmate never answers a worker's gate. Step agents wedge 15 to 30 minutes at 0% CPU sometimes and self-resume; only kill after 30 minutes and only the captain does it. While GitHub Actions billing is off the `ci` step is always red: classify it as environment and merge on the local bar (section 9).

## 4. The firstmate home (10 min)

```bash
cd ~
git clone https://github.com/karanmrn/firstmate.git karan-agent-workspace   # fork of kunchenguid/firstmate
cd karan-agent-workspace
git remote add upstream https://github.com/kunchenguid/firstmate.git
ln -sfn .agents/skills .claude/skills
```

Private, gitignored files to carry over (copy from the old Mac; `data/keys.env` by hand from the password manager):

| Path | Contents |
|---|---|
| `config/crew-harness` | `grok` (static fallback only; dispatch profiles below decide in practice) |
| `config/backend` | `herdr` |
| `config/startup-memory-budget` | `7500` |
| `config/crew-dispatch.json` | the model-routing rules (section 6) |
| `data/captain.md` | the laws and preferences; the durable rulebook |
| `data/captain-shared.md`, `data/learnings.md`, `data/projects.md`, `data/secondmates.md`, `data/backlog.md` | copy as-is |
| `data/keys.env` (mode 600) | Exa, Firecrawl, ElevenLabs, PostHog, Supabase service role. **you** |
| `data/checkpoints/` | dated state snapshots; `required-checks-2026-09-03.json` restores branch protection |
| `data/codex-pr-review/` | review notes from the 3 Sep lane; useful precedent |
| `.env` | absent unless Relay (public mentions) is enabled |

`data/projects.md` must contain: `- pubmax [no-mistakes +yolo] - PUBMAXX app (projects/pubmax; github.com/Singularityszn/pubmax)`. Clone the product:

```bash
mkdir -p projects && git clone https://github.com/Singularityszn/pubmax.git projects/pubmax
(cd projects/pubmax && npm ci && treehouse init)
```

Start firstmate: `cd ~/karan-agent-workspace && claude --model claude-fable-5.1` (fall back to `claude-fable-5` if the id is refused). The SessionStart hook runs `bin/fm-session-start.sh`; if the digest is not on screen, run it once yourself. Then say what to work on. First message on the new Mac: "read fable52.md and sol5g.md, then the latest data/checkpoints, and report state".

## 5. PUBMAXX repo tooling (10 min)

```bash
cd ~/karan-agent-workspace/projects/pubmax
npx playwright install chromium
cp .env.example .env.local              # you: Supabase URL, anon key, service role, PostHog, Exa, Firecrawl, ElevenLabs
npm run typecheck && npm test -- --run  # ~13,300 unit tests; full tsc needs the 4096 heap
```

Deploy (**you** log in once): `npx -y vercel@latest login`, team `pubmax69`, project `chengdu`. Deploy recipe, always from a fresh shallow clone of main:

```bash
git clone --depth 1 https://github.com/Singularityszn/pubmax.git deploy-main && cd deploy-main
mkdir -p .vercel && echo '{"projectId":"prj_FAC09rdCxDiGujUHeDOeZ04JLymc","orgId":"team_ZHYOvhX8M0Gxyq4J3XOgOwmF"}' > .vercel/project.json
npx -y vercel@latest deploy --prod --yes --scope pubmax69
```

Only on the captain's word, one deploy a day unless the captain says otherwise. Check the live site on a real phone afterwards (Vercel's bot challenge blocks curl and headless browsers).

Supabase (**you**): project `iankajxliutqogqkmvdg`. Migrations are applied through the claude.ai Supabase connector (`apply_migration`, strip `begin`/`commit`) after the captain says "apply <number>", then verified with `execute_sql` against `pg_proc` or the table. Ledger truth: 0123 to 0126, 0133 to 0136 are live; 0127 to 0132 are records only (see #1322's label fence).

## 6. Model routing (how work is dispatched)

`config/crew-dispatch.json` is the router. Firstmate reads it at every spawn, matches the task against the rules, then ranks the matched array by live quota (`quota-axi`) and the captain's stated preferences. Current rules:

| Work | Array (first is preferred) | Why |
|---|---|---|
| Difficult, architectural, multi-system, perf-critical, high-risk implementation | codex `gpt-5.6-luna` xhigh | captain 27 Aug: "based on difficulty give it to GPT 5.6 (luna, max)" |
| Planning, design, scouting, investigation, audit (deliverable is a plan or report) | cursor `claude-fable-5-thinking-high`, then claude `claude-fable-5` high, then pi `anthropic/claude-fable-5` high | planning stays Fable-class; Cursor first while Ultra is healthy |
| Everything else (default) | codex `gpt-5.6-luna` xhigh, cursor `composer-2.5`, cursor `cursor-grok-4.6-high-fast`, claude `claude-opus-5` high, pi `anthropic/claude-opus-5`, opencode `openrouter/anthropic/claude-opus-5`, grok `grok-4.6` high | ranked live by quota; explicit captain model wins |

Standing notes inside the file: use `-fast` variants wherever the catalog offers one; Composer 2.5 is already Cursor's fast model; the grok CLI has no fast tier and reasoning class is never silently downgraded; OpenRouter models ride OpenCode or Pi, or `bin/fm-openrouter-launch.sh` on an explicit ask; build/ship workers on Codex run luna at max effort.

What actually ran 1 to 3 Sep: orchestrator Claude Fable 5.1; ship and review workers `claude-opus-5` at effort xhigh (Codex weekly quota was spent and Cursor was reserved for the captain's own sessions); Codex desktop app on `gpt-5.6` for the parallel feature stream. Effort ladder when no rule names one: low for well-understood explicit work, xhigh for ambiguous investigation or design, never max without the captain saying so.

pstack delegation (`~/.config/uni-pstack/models.env`): `PSTACK_CODEX_MODEL=gpt-5.6-sol`, `PSTACK_CODEX_REASONING=auto`, `PSTACK_CODEX_SERVICE_TIER=fast`. Sol caps at medium reasoning.

## 7. Skills (15 min)

Skill folders are plain directories in `~/.claude/skills` (877), `~/.agents/skills` (1075) and `~/.codex/skills` (860). Copy all three from the old Mac (rsync over the network or a USB stick); that is 20 minutes and preserves every pin. `skills-lock.json` at the fleet home root lists installs made with `npx skills`. If copying is impossible, reinstall the set the fleet actually used this fortnight:

| Skill | Used for | Source |
|---|---|---|
| `impeccable` (+ `$critique`, `$audit`, `$polish`, `$optimize`, `live`) | every design lane; the visual bar | `npx skills add pubmaxxing/impeccable` |
| `pstack` (+ `architect`, `arena`, `interrogate`, `unslop`, `tdd`, `setup-pstack`) | review playbook, multi-model panels, prose de-slop | `npx skills add pstack/uni-pstack` |
| `code-review`, `thermo-nuclear-review`, `codebase-design` | the four-skill PR review lane (3 Sep Codex PRs) | Claude plugin marketplace / `skills-lock.json` |
| `gnhf` | companion-mode overnight runs ("complete and merge everything planned") | `npx skills add kunchenguid/gnhf` |
| `grilling`, `ideate`, `brainstorming` | one-question-at-a-time intake before any new feature | `~/.claude/skills`, standing rule in `~/.claude/CLAUDE.md` |
| `compact`, `ecc:strategic-compact` | context management on long orchestration days | ecc plugin |
| `compound-engineering:ce-plan`, `lfg`, `ce-work`, `ce-code-review` | plan then ship pipelines when the captain says "lfg" | compound-engineering plugin |
| `afk` | away mode; daemon batches wakes while the captain sleeps | firstmate `.agents/skills` |
| `herdr` | herdr CLI reference for spawn, prompt, read | `herdr --skill` |
| `vision`, `claude-api`, `maplibre/*`, `tdd`, `prototype` | worker-side references named in briefs | `kunchenguid/vision`, `mattpocock/skills`, `maplibre/skills` |
| `last30days`, `term-radar`, `graphify` | research and knowledge-graph asides | `skills-lock.json` |
| firstmate internal: `harness-adapters`, `stuck-crewmate-recovery`, `ask-user-authority`, `captain-hold-lifecycle`, `project-management`, `secondmate-provisioning`, `quota-array-dispatch`, `fmx-respond`, `stow`, `updatefirstmate` | loaded by firstmate at their triggers, never invoked by hand | ship with the firstmate clone |

Standing skill rules in `~/.claude/CLAUDE.md` (copy that file too): `ideate` before building any new idea; `/graphify` on request; ASD-STE100 plain English, no em dashes; project-level routing (`office-hours`, `investigate`, `ship`, `qa`, `review`, `design-review`, `checkpoint`, `health`).

## 8. Agent CLIs and MCP (5 min)

```bash
vp install gh-axi lavish-axi chrome-devtools-axi quota-axi tasks-axi
```

`gh-axi` for GitHub, `chrome-devtools-axi` for browser work (one Chrome; never run Playwright MCP beside it), `lavish-axi` for visual reports the captain annotates, `quota-axi` for model quota at dispatch, `tasks-axi` for the backlog (`.tasks.toml` is tracked).

MCP servers live in `~/.claude.json` and `~/.codex/config.toml`; `docs/mcp-servers.md` in the fleet home has every install snippet and the keep/remove verdict. Keep `context7`, `exa`, `firecrawl`, `codex`, `posthog`, `tavily`. claude.ai connectors (Supabase, Vercel, ElevenLabs, Gmail, Notion, Google Drive, PostHog) are per-account at claude.ai/settings/connectors (**you**). Each MCP server is two Node processes per agent; on 24GB that stops mattering, but keep the list to what the work uses.

## 9. Workflows

**Daily loop.** Session start digest, then intake: firstmate names the project, classifies ship vs scout, resolves delivery mode (`no-mistakes` with `yolo` on for pubmax) and writes `data/<task>/brief.md` from `bin/fm-brief.sh`. Spawn through `bin/fm-spawn.sh` (or by hand: `treehouse get` -> `herdr tab create` -> `herdr agent start` -> write `state/<task>.meta` -> `herdr agent prompt`). Steer with `bin/fm-send.sh <task> "<text>"` (`--resolve-key` when answering a decision). Watch through the Stop-hook watcher; drain wakes with `bin/fm-wake-drain.sh` and acknowledge with the exact `--ack-through` line it prints. Worker reports `done: PR <url>`; firstmate runs `bin/fm-pr-check.sh`, merges with `bin/fm-pr-merge.sh <task> <url>`, refreshes the clone, cleans the worktree, archives `state/<task>.*` to `state/.retired/`, and writes the backlog. Deploy on the word. Checkpoint to `data/checkpoints/<date>-pubmax.md` and the memory index before any restart.

**Local merge bar (while GitHub Actions is off).** changed-file ESLint 0 errors, focused specs, the full unit suite, `tsc` (scoped if it OOMs), and for a migration or RPC the effective PostgreSQL proof run alone. Counts go in the task status line before merge. Restore the 12 required checks from `data/checkpoints/required-checks-2026-09-03.json` once billing is fixed.

**Small branches.** A nine-commit branch took 11 hours to validate; one-commit branches take about an hour. Split before validating. Two validation lanes at once on 8GB; four fit on 24GB (section 10).

**Codex PR review lane.** The captain builds features in the Codex app on its own branches. Firstmate spawns one reviewer worker with a brief like `data/codex-pr-review/brief.md`: rebase, run `/pstack` `/code-review` `/thermo-nuclear-review` `/codebase-design`, fix in-intent findings, local bar, push with `--force-with-lease`, write `data/codex-pr-review/<n>.md`, verdict merge or close. Firstmate merges. Never let a root licence file or a loosened perf ceiling ride in.

**GNHF companion mode.** For "I am going to sleep, wake me with everything built": firstmate runs the queue in companion mode, verifies each result itself, never treats a worker's done as acceptance, batches updates, and stops only for decisions, credentials, or failures.

**Migrations.** Worker writes `supabase/migrations/<ts>_<n>_<slug>.sql` and proves it on real Postgres in the PR. After merge, the captain says "apply <n>"; firstmate applies through the Supabase connector and verifies. Never in the same breath as the merge.

**Design lanes.** `impeccable` `$critique` on the live site at 390x844 first, findings into a brief, one worker per surface, screenshot before and after, captain reviews in lavish.

**Away mode.** `/afk` when leaving; the daemon batches routine wakes and injects one digest. First plain message ends it.

**Checkpoints and handoffs.** `data/checkpoints/<date>-pubmax.md` (fleet-private), the memory index entry, and a public `<name>.md` at the pubmax root when the captain asks (`sol30aug.md`, `sol5g.md`, `fable52.md`). Everything a new session needs to resume is in those three places; conversation memory is never the record.

## 10. Sizing for the new Mac

The 8GB Mac set the limits in `data/captain.md`: two workers, two validation lanes, act below 25% free memory or above 3GB swap, reclaim disk below 5GB. Those thresholds are ratios and still apply. What changes on 24GB / 18 cores:

- Run four workers and three validation lanes at once as the new default; a no-mistakes lane peaks around 3GB (Next build plus Postgres tests plus the step agent), a review worker around 1.5GB, the Codex app about 2GB. Measure the first day with `vm_stat` and `sysctl vm.swapusage` on the command deck and write the observed ceiling into `data/captain.md` before raising further.
- `NODE_OPTIONS=--max-old-space-size=4096`; full `tsc` no longer needs scoping.
- treehouse pool of four slots.
- Postgres test clusters: the 32 shared-memory segment limit is a macOS kernel default, not a RAM limit. Four parallel lanes each starting a `pubmax-rls-*` cluster will still hit it if orphans pile up. Keep the `ipcs -m` check on the command deck and clean with `pg_ctl -D <dir> stop -m fast` then `ipcrm -m <id>`.
- 1TB: node_modules per worktree is ~850MB; six worktrees plus the pool plus pnpm store is about 8GB. Disk stops being a daily concern; keep the 5GB floor anyway.
- The 20-core GPU is not used by any fleet tool today. Local models (Ollama, MLX) become possible for cheap classification or embedding work; nothing in the plan depends on it.

## 11. Laws to carry over (from data/captain.md)

Speed is the defining factor and perf ceilings only ratchet down. Never merge red on the local bar. No CI secrets, no keyless auth bypass. Raw viewer coordinates never in a URL or cache key. Migrations and deploys only on the captain's word. Kickers above headings are brand. PUBMAXX / PUBMAXXING branding, British English, no em dashes. Workers never idle; a finished worker exits and its pane closes. Never tear down unlanded work; deep-verify before deleting anything. Address the captain as Captain.

## 12. Known traps

- GitHub Actions billing lapse: every job fails in two seconds. Local bar, and restore protection later.
- Orphaned `pubmax-rls-*` Postgres clusters exhaust shared memory and make every DB test "fail to start". See section 10.
- `public/data/weather/latest.json` older than 48h fails the release gate: `npm run refresh:weather` as a one-file commit.
- Vercel bot challenge blocks curl and headless browsers against production; use a phone.
- ElevenLabs free tier: 3 images a day for Pal art (flow `I9rZih8pT1Z63EYwBSJF`).
- `bin/fm-teardown.sh` fails at `cd pubmax` on this home; use `treehouse return --force` from `projects/pubmax`, then `treehouse prune --yes`, or `git worktree remove --force`.
- A herdr worker whose composer holds an unsubmitted doorbell: `herdr pane send-keys <pane> Enter`.
- Persistent `cd` is blocked in firstmate's shell by a hook; use `git -C <dir>` or a `(cd <dir> && ...)` subshell.
- Stop-hook watcher arm failing repeatedly: check `state/.watch-cycle-exits.log` for `confirmation-timeout`; the `FM_ARM_CONFIRM_TIMEOUT=60` export fixes it.
