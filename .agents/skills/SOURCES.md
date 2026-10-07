# Project skills

PubMaxxing keeps project skills in this directory only. General engineering skills stay in `~/.agents/skills` and are not copied here.

Cursor loads `.agents/skills/<name>/SKILL.md`. There is no `skills/` mirror and no `.cursor/skills/` tree.

## Kept for this repo

These were already in the tree. They are not part of the five packs below.

| Directory | Why it stays |
| --- | --- |
| `debugging-capacitor` | Capacitor debugging for this app's native shell. Vendored from [Cap-go/capgo-skills](https://github.com/Cap-go/capgo-skills). |
| `maplibre-source-wiring` | MapLibre source wiring for this app's map. Vendored from [maplibre/maplibre-agent-skills](https://github.com/maplibre/maplibre-agent-skills). |
| `maplibre-terrain-rendering` | MapLibre terrain rendering for this app's map. Same upstream repo. |
| `maplibre-tile-sources` | MapLibre tile sources for this app's map. Same upstream repo. |
| `maplibre-v6-migration` | MapLibre GL JS v5 to v6 migration for this app's map. Same upstream repo. |
| `continual-learning` | Approval-gated mining of this workspace's transcripts into `AGENTS.md`. It is not in `~/.agents/skills`. |

The MapLibre and Capacitor rows above were vendored for the map and native shell in pull request 1678. The 2 Oct 2026 refresh and the store-path skills are recorded below.

## Written for this repo

These have no upstream. They describe this repo's own conventions and point at the files that own each rule. When a rule in one of those files changes, change the skill with it.

| Directory | What it covers |
| --- | --- |
| `pubmax-nextjs` | Route handlers, the API error envelope, `proxy.ts`, CSP, caching and file tracing. |
| `pubmax-supabase` | The admin and browser clients, stores, migrations and rollbacks, RLS helpers and private Realtime channels. Read it with the vendored `supabase` skill. |
| `pubmax-ai-sdk` | The `ai` v7 AI Gateway call, the direct OpenRouter calls, TypeSafe, paid-spend lanes and model tracing. |

## Packs

No two packs shipped the same directory name or the same frontmatter `name`, so nothing was dropped for a collision.

Upstream `SKILL.md` trees were copied flat, one directory per skill. Plugin tests, adapters, and example galleries were not copied.

### emilkowalski/skills

- Repo: https://github.com/emilkowalski/skills
- Commit: `e8a175de22ae1e49370fc144c1f3bb9aeedf988d` (`main`)
- Checked 4 Oct 2026. All thirteen installed skill trees match this tip, preserving the `emil-prototype` namespace. The new tip only adds `break-ui`, which was not installed; the thirteen installed trees are unchanged.

`animate`, `animate-expo`, `animation-vocabulary`, `apple-design`, `ask-sonner`, `emil-design-eng`, `find-animation-opportunities`, `improve-animations`, `mobile-native`, `pick-ui-library`, `emil-prototype`, `review-animations`, `write-swift`.

`emil-prototype` is the upstream `prototype` skill. The directory and the frontmatter `name` are `emil-prototype` so this copy does not shadow the machine-wide `prototype` skill.

### Leonxlnx/taste-skill

- Repo: https://github.com/Leonxlnx/taste-skill
- Commit: `e3c92037548e3e49bea8e6b906c99a8549654e71` (`main`)
- Checked 7 Oct 2026. All thirteen installed skill trees match this tip.

Directory name, then frontmatter `name` when it differs:

| Directory | Name |
| --- | --- |
| `brandkit` | `brandkit` |
| `brutalist-skill` | `industrial-brutalist-ui` |
| `gpt-tasteskill` | `gpt-taste` |
| `image-to-code-skill` | `image-to-code` |
| `imagegen-frontend-mobile` | `imagegen-frontend-mobile` |
| `imagegen-frontend-web` | `imagegen-frontend-web` |
| `minimalist-skill` | `minimalist-ui` |
| `output-skill` | `full-output-enforcement` |
| `redesign-skill` | `redesign-existing-projects` |
| `soft-skill` | `high-end-visual-design` |
| `stitch-skill` | `stitch-design-taste` |
| `taste-skill` | `design-taste-frontend` |
| `taste-skill-v1` | `design-taste-frontend-v1` |

### jakubkrehel/skills

- Repo: https://github.com/jakubkrehel/skills
- Commit: `d574cc8a576dc24256ad38268b8d03d86724a1b3` (`main`)
- Refreshed 7 Oct 2026. The installed trees match this tip, except one local guard below. `state-machine` was added because `variant` now refers to it.

`state-machine` keeps one local guard the upstream file does not. Upstream makes every Next.js scratch page `"use client"`, but a client page cannot import a Server Component. The local step 3 keeps the page a Server Component for a server target, with only the switcher on the client.

`better-accessibility`, `better-colors`, `better-interface`, `better-layout`, `better-typography`, `better-ui`, `better-writing`, `break`, `explain-interface`, `interface-review`, `variant`, `state-machine`.

### gnurio/refactoring-ui-plugin

- Repo: https://github.com/gnurio/refactoring-ui-plugin
- Commit: `00781eab1dde7fdb720d63f8d6c8148bf5835a31` (`main`)
- Checked 2 Oct 2026. This is still the upstream tip.

`01-establish-visual-hierarchy`, `02-apply-typography-scale`, `03-build-color-palette`, `04-apply-consistent-spacing`, `05-design-button-hierarchy`, `06-eliminate-visual-clutter`, `07-design-empty-states`, `08-use-shadows-appropriately`, `09-manage-color-contrast`, `10-group-related-elements`, `meta-refactor-ui`.

The plugin's root `SKILL.md` and `skills.json` are in `refactoring-ui-plugin/`. Each `path` in `skills.json` is `.agents/skills/<id>/SKILL.md`. `meta-refactor-ui` reads `../refactoring-ui-plugin/skills.json`.

### shadcn-labs/skills

- Repo: https://github.com/shadcn-labs/skills
- Commit: `5316082202ab6a7e0779b16b5c58b846c006a460` (`main`), refreshed 2 Oct 2026 from `cb4cd2b719e9539720f3cd07cf297999e58b5eff`

Kept from that pack: `icon-set-audit`, `icon-set-extend`, `icon-set-generator`, `launch-shadcn-registry`, `tailwind-to-stylex`.

Chinese companions for `launch-shadcn-registry` and `tailwind-to-stylex` are not kept. The English skills stay.

Dropped, because they sit outside that UI scope or duplicate the machine-wide set: `docs-i18n-zh`, `mastra-file-agents`, `skill-creator`, `unslop`, `writing-great-skills`. The 2 Oct 2026 upstream also added Chinese companions for `mastra-file-agents`. That skill stays dropped.

## MapLibre and Capacitor refreshes

These were already in the tree. Each repo below records its refresh date and upstream tip. `debugging-capacitor` keeps three local guards the upstream file does not: debug-only WebView and cleartext flags, ATS exceptions never committed, and no `rm -rf node_modules` in a shared worktree unless someone asks.

### maplibre/maplibre-agent-skills

- Repo: https://github.com/maplibre/maplibre-agent-skills
- Commit: `fa618af49728952f7aeca842ad93f51b9b530018` (`main`)
- Refreshed 7 Oct 2026.

Refreshed: `maplibre-source-wiring`, `maplibre-terrain-rendering`, `maplibre-tile-sources`, `maplibre-v6-migration`.

Added, because the refreshed source-wiring skill points at them and this app styles a MapLibre map: `maplibre-cartography`, `maplibre-fonts-glyphs`.

Left upstream: `maplibre-pmtiles-patterns` (this app does not host PMTiles), `maplibre-mapbox-migration`, `maplibre-running-evals`, `maplibre-skill-authoring`. Vendored copies do not link to `maplibre-pmtiles-patterns` or `maplibre-mapbox-migration`. Those relative links are removed. PMTiles setup stays on the Protomaps docs already cited in `maplibre-tile-sources`.

### Cap-go/capgo-skills

- Repo: https://github.com/Cap-go/capgo-skills
- Commit: `c0afb73c859a85c35c8d03d3dc9afdee5fe78d30` (`main`)
- Refreshed 2 Oct 2026.

Refreshed: `debugging-capacitor`.

## Stack skills added 2 Oct 2026

Twenty-five skills. Official vendor repos first. Nothing here duplicates the machine-wide set (Poteto, Matt Pocock, Kun Chen, Superpowers, Addy Osmani, jev, typesafe-ai, new-feature, verification-before-completion, last30days) or a skill already in this directory.

A last30days run on 2 Oct 2026 (Reddit, YouTube, Hacker News, GitHub, Digg) ranked [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills), [supabase/agent-skills](https://github.com/supabase/agent-skills), [elevenlabs/skills](https://github.com/elevenlabs/skills), and [Cap-go/capgo-skills](https://github.com/Cap-go/capgo-skills). PostHog's Next.js skills are the official [PostHog/skills](https://github.com/PostHog/skills) tree. Supabase documents the install at [supabase.com/docs/guides/ai-tools/ai-skills](https://supabase.com/docs/guides/ai-tools/ai-skills). Vercel documents React and Next.js skills at [vercel.com/docs/agent-resources/skills](https://vercel.com/docs/agent-resources/skills).

### supabase/agent-skills

- Repo: https://github.com/supabase/agent-skills
- Commit: `c9be0e931b7930f7d02126d04774d904c381e7d7` (`main`)
- Checked 7 Oct 2026. This is the upstream tip.

`supabase`, `supabase-postgres-best-practices`.

### vercel-labs/agent-skills

- Repo: https://github.com/vercel-labs/agent-skills
- Commit: `063bee94c3f4df8453406c830b0a7df0f2860278` (`main`)
- Checked 4 Oct 2026. Four installed skill trees match upstream. `vercel-optimize` keeps five local changes:
  - `CONTRIBUTING.md`, `README.md`, `references/data-collection.md` and `references/playbooks/README.md` say the upstream test package `packages/vercel-optimize-tests` was not vendored.
  - `lib/vercel.mjs` resolves a `usr_` link to the CLI username scope only when the signed-in user ID equals the linked ID. Upstream also accepts a missing user ID. This is the scope fix from `13121954d`.

`react-best-practices` (frontmatter `vercel-react-best-practices`), `composition-patterns` (`vercel-composition-patterns`), `react-view-transitions` (`vercel-react-view-transitions`), `web-design-guidelines`, `vercel-optimize`.

`web-design-guidelines` tells the agent to fetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` when someone asks for a review. That fetch is not an install step.

`vercel-optimize` ships reviewed local scripts. They call the Vercel CLI when an agent runs the skill. They do not run on install. `collect-signals.mjs` redacts sensitive text before it prints JSON.

Left upstream: `deploy-to-vercel` (the machine already has `deploy-with-vercel`), `react-native-skills` (this app uses Capacitor), `writing-guidelines` (generic, and the machine already has writing skills), `vercel-cli-with-tokens` (token handling).

### elevenlabs/skills

- Repo: https://github.com/elevenlabs/skills
- Commit: `25bd9ad1c31af658fba6cc7d8ec1f1e2a715c049` (`main`)
- Refreshed 7 Oct 2026.

`elevenlabs-agents` is the upstream `agents` skill. The directory and the frontmatter `name` are `elevenlabs-agents` so this copy does not register as a generic agents skill. Also `text-to-speech`, `speech-to-text`, `speech-engine`.

Upstream `references/installation.md` in three of these skills offered `curl … | sh` for the ElevenLabs CLI. Those blocks are removed. npm, Homebrew, and Scoop remain.

Left upstream: `dubbing`, `music`, `sound-effects`, `voice-changer`, `voice-isolator`, `setup-api-key`, `update-skills-from-changelog`.

### PostHog/skills

- Repo: https://github.com/PostHog/skills
- Commit: `8321fc1dab05b8f3dfdb6d6b5c76c097b99b8677` (`main`)
- Checked 7 Oct 2026. This is the upstream tip.

`integration-nextjs-app-router`, `feature-flags-nextjs`, `error-tracking-nextjs`.

The rest of that repo is other frameworks or PostHog-product operations. Those stay upstream.

### Cap-go/capgo-skills (store path)

Same commit as the Capacitor refresh above.

`capacitor-app-store`, `capacitor-apple-review-preflight`, `capacitor-best-practices`, `capacitor-accessibility`, `capacitor-security`, `safe-area-handling`, `capacitor-testing`, `capacitor-performance`, `capacitor-deep-linking`.

`capacitor-security` includes a fake `sk_live_abc123xyz` string inside a "do not hardcode keys" example. It is not a credential.

Left upstream: Capgo cloud and live-update skills, version-upgrade skills (this app is already on Capacitor 8), plugin-authoring skills, Ionic and Konsta UI skills.

`capacitor-best-practices` is edited locally so core, CLI, iOS, and Android install on this repo's Capacitor 8 pin (`@8`), not `@latest`. Do not leave that major unless someone asks.

### maplibre/maplibre-agent-skills (added)

Same commit as the MapLibre refresh above. `maplibre-cartography`, `maplibre-fonts-glyphs`.

## Machine-wide design addition, 4 Oct 2026

Anthropic `frontend-design` is installed in the canonical machine-wide skill root at `~/.agents/skills/frontend-design`, exposed to Codex. Source: [anthropics/skills](https://github.com/anthropics/skills), commit `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`. Claude already provides this skill through its enabled synced plugin, so no second Claude copy was added.

`docs/DESIGN_SYSTEM.md` and `docs/VOICE.md` remain authoritative for this project. Upstream design skills do not replace project tokens, brand identity, price semantics or copy laws.

## Maintenance check, 7 Oct 2026

All eleven documented upstream repositories were checked at their default branch tips. The installed Jakub skills, MapLibre cartography and glyph guidance, and ElevenLabs `elevenlabs-agents` configuration and client-tool references, `speech-engine` SDK references, and `text-to-speech` skill, installation, streaming and voice-settings references were refreshed. Other installed trees have no upstream content changes. Existing namespace changes, install guards, removed sibling links, and the Vercel scope fix remain. The added `state-machine` skill keeps a local Next.js server-boundary guard. Upstream CHANGELOG.md files were not modified. The three PUBMAXX-specific skills have no upstream.
