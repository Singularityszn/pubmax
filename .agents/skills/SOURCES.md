# Project skills

PubMaxxing keeps only project-relevant skills in this directory: the skills written for this repo, and the vendored skills for its stack (Supabase, MapLibre and the Capacitor shell). General engineering, design, CI and media skills live in `~/.agents/skills` and are not copied here.

Cursor loads `.agents/skills/<name>/SKILL.md`. Claude Code loads the same files through `.claude/skills`, a committed symlink to this directory. There is no `skills/` mirror, no `.cursor/skills/` tree and no copy under `.claude/`.

## Written for this repo

These have no upstream. They describe this repo's own conventions and point at the files that own each rule. When a rule in one of those files changes, change the skill with it.

| Directory | What it covers |
| --- | --- |
| `pubmax-nextjs` | Route handlers, the API error envelope, `proxy.ts`, CSP, caching and file tracing. |
| `pubmax-supabase` | The admin and browser clients, stores, migrations and rollbacks, RLS helpers and private Realtime channels. Read it with the vendored `supabase` skill. |
| `pubmax-ai-sdk` | The `ai` v7 AI Gateway call, Claude API calls, TypeSafe, paid-spend lanes and model tracing. |

## Vendored for this stack

| Directory | Why it stays |
| --- | --- |
| `ste` | Simplified Technical English for every message to the captain. The root `AGENTS.md` points here. |
| `supabase`, `supabase-postgres-best-practices` | The database, auth, RLS and migration stack. |
| `maplibre-cartography`, `maplibre-fonts-glyphs`, `maplibre-source-wiring`, `maplibre-sprites-icons`, `maplibre-terrain-rendering`, `maplibre-tile-sources`, `maplibre-v6-migration` | The 3-D map. The kept MapLibre skills link to each other, so they stay as a set. |
| `capacitor-best-practices`, `capacitor-deep-linking`, `capacitor-apple-review-preflight`, `debugging-capacitor` | The iOS and Android shell and the store review. A kept Capacitor skill may name a sibling (for example `capacitor-security`) that now lives in `~/.agents/skills`. |

### maplibre/maplibre-agent-skills

- Repo: https://github.com/maplibre/maplibre-agent-skills
- Commit: `ccc4226a617bb851814e24ff748beeeacac32902` (`main`)
- Refreshed 29 Oct 2026.

Refreshed: `maplibre-source-wiring`, `maplibre-terrain-rendering`, `maplibre-tile-sources`, `maplibre-v6-migration`.

Added, because refreshed skills point at them and this app styles MapLibre maps: `maplibre-cartography`, `maplibre-fonts-glyphs`, `maplibre-sprites-icons`.

Left upstream: `maplibre-pmtiles-patterns` (this app does not host PMTiles), `maplibre-mapbox-migration`, `maplibre-running-evals`, and `maplibre-skill-authoring`. Vendored copies do not link to other uninstalled MapLibre skills. PMTiles setup stays on the Protomaps docs already cited in `maplibre-tile-sources`.

### Cap-go/capgo-skills

- Repo: https://github.com/Cap-go/capgo-skills
- Commit: `e90bb5639130e34387f00bf0a95c6d47e4a2ebb8` (`main`)
- Refreshed 29 Oct 2026.

Refreshed: `debugging-capacitor`.

`debugging-capacitor` keeps three local guards the upstream file does not: debug-only WebView and cleartext flags, ATS exceptions never committed, and no `rm -rf node_modules` in a shared worktree unless someone asks.

`capacitor-best-practices`, `capacitor-deep-linking` and `capacitor-apple-review-preflight` come from the same commit.

`capacitor-best-practices` keeps a local [Stay on Capacitor 8](capacitor-best-practices/SKILL.md#stay-on-capacitor-8) section, so core, CLI, iOS, and Android install on this repo's Capacitor 8 pin (`@8`), not `@latest` or `@next`. The 29 Oct refresh replaced the upstream file, and the section was added back to it. Do not leave that major unless someone asks.

Local corrections:

- Release, security, debugging and Apple review guidance preserve the required production `server.url: "https://pubmaxxing.com/"` from `capacitor.config.ts`. Development hosts, LAN IPs and cleartext remain excluded from release builds.
- The `capacitor-deep-linking` handler skips a duplicate launch URL only when the first `appUrlOpen` delivers it before `getLaunchUrl()` resolves. Later intentional opens of the same URL still route. Angular preserves custom-scheme hosts and query parameters, as the React, Vue and shared examples do.

### supabase/agent-skills

- Repo: https://github.com/supabase/agent-skills
- Commit: `c9be0e931b7930f7d02126d04774d904c381e7d7` (`main`)
- Checked 7 Oct 2026. This is the upstream tip.

`supabase`, `supabase-postgres-best-practices`.

### mryll/skills

[mryll/skills](https://github.com/mryll/skills), commit `e0bacd42498b18e4c5472689bd7a0c19bd72da68`, MIT (licence copied into the skill directory). `ste`: Simplified Technical English (ASD-STE100), with a dictionary checker script (`scripts/ste-check.sh`, POSIX shell and gawk, no network access). The root `AGENTS.md` law "Talk to the captain in Simplified Technical English" points here. Agents write their replies in STE style from memory. They run the skill when the captain asks for a checked rewrite or an STE compliance check.

Local corrections in `scripts/ste-check.sh` (pull request 2184, from Codex review findings): a technical-verb category must be exactly 1 to 4 with an optional letter (`tv12` was accepted), and a word plus apostrophe-s is checked as a possessive under rule GR-8 instead of always being reported as a contraction. A pronoun or adverb plus apostrophe-s (`it's`, `there's`, `let's`) is still a contraction.

## Moved out of the repo, 7 Nov 2026

By the captain's decision, this directory keeps about 15 project-relevant skills. The 77 skills below left the repo. Install one in `~/.agents/skills` when a task needs it. Each upstream source and local correction is in this file's git history.

- Design and UI: `01-establish-visual-hierarchy` to `10-group-related-elements`, `meta-refactor-ui`, `refactoring-ui-plugin`, `better-accessibility`, `better-colors`, `better-interface`, `better-layout`, `better-typography`, `better-ui`, `better-writing`, `break`, `explain-interface`, `interface-review`, `state-machine`, `variant`, `brandkit`, `brutalist-skill`, `gpt-tasteskill`, `minimalist-skill`, `redesign-skill`, `soft-skill`, `stitch-skill`, `taste-skill`, `taste-skill-v1`, `output-skill`, `image-to-code-skill`, `imagegen-frontend-mobile`, `imagegen-frontend-web`, `icon-set-audit`, `icon-set-extend`, `icon-set-generator`, `launch-shadcn-registry`, `tailwind-to-stylex`, `web-design-guidelines`.
- Motion and platform craft: `animate`, `animate-expo`, `animation-vocabulary`, `apple-design`, `ask-sonner`, `emil-design-eng`, `emil-prototype`, `find-animation-opportunities`, `improve-animations`, `mobile-native`, `pick-ui-library`, `review-animations`, `write-swift`.
- React and Vercel: `react-best-practices`, `composition-patterns`, `react-view-transitions`, `vercel-optimize`.
- PostHog: `integration-nextjs-app-router`, `feature-flags-nextjs`, `error-tracking-nextjs`.
- Capacitor: `capacitor-accessibility`, `capacitor-app-store`, `capacitor-performance`, `capacitor-security`, `capacitor-testing`, `safe-area-handling`.
- CI: `ci-speedup`, `ci-score`, `ci-secure`.
- Voice and media: `elevenlabs-agents`, `speech-engine`, `speech-to-text`, `text-to-speech`.
- Workflow: `continual-learning`.
