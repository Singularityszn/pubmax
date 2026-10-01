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
| `continual-learning` | Approval-gated mining of this workspace's transcripts into `AGENTS.md`. `__tests__/skillInstallationIntegrity.test.ts` fences that contract. It is not in `~/.agents/skills`. |

The MapLibre and Capacitor skills are the set vendored for this repo's map and native shell (pull request 1678).

## Packs

No two packs shipped the same directory name or the same frontmatter `name`, so nothing was dropped for a collision.

Upstream `SKILL.md` trees were copied flat, one directory per skill. Plugin tests, adapters, and example galleries were not copied.

### emilkowalski/skills

- Repo: https://github.com/emilkowalski/skills
- Commit: `d16ebe60d09a5ba2afcb7054ede9d0a10c9f6128` (`main`)

`animate`, `animate-expo`, `animation-vocabulary`, `apple-design`, `ask-sonner`, `emil-design-eng`, `find-animation-opportunities`, `improve-animations`, `mobile-native`, `pick-ui-library`, `prototype`, `review-animations`, `write-swift`.

### Leonxlnx/taste-skill

- Repo: https://github.com/Leonxlnx/taste-skill
- Commit: `ce26fc25c0e5e8cab638f883de62d9a86ee5e45b` (`main`)

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
- Commit: `267330e1adfc66a718fb65fa6918c1f06d0a689e` (`main`)

`better-accessibility`, `better-colors`, `better-interface`, `better-layout`, `better-typography`, `better-ui`, `better-writing`, `break`, `explain-interface`, `interface-review`, `variant`.

### gnurio/refactoring-ui-plugin

- Repo: https://github.com/gnurio/refactoring-ui-plugin
- Commit: `00781eab1dde7fdb720d63f8d6c8148bf5835a31` (`main`)

`01-establish-visual-hierarchy`, `02-apply-typography-scale`, `03-build-color-palette`, `04-apply-consistent-spacing`, `05-design-button-hierarchy`, `06-eliminate-visual-clutter`, `07-design-empty-states`, `08-use-shadows-appropriately`, `09-manage-color-contrast`, `10-group-related-elements`, `meta-refactor-ui`.

The plugin's root `SKILL.md` and `skills.json` are in `refactoring-ui-plugin/`. `skills.json` still records upstream paths of the form `skills/<id>/SKILL.md`. In this checkout those skills are siblings of `refactoring-ui-plugin/`, not children of it. `meta-refactor-ui` names each skill by id, and those ids match the sibling directories.

### shadcn-labs/skills

- Repo: https://github.com/shadcn-labs/skills
- Commit: `cb4cd2b719e9539720f3cd07cf297999e58b5eff` (`main`)

From `skills/`: `icon-set-audit`, `icon-set-extend`, `icon-set-generator`, `launch-shadcn-registry`, `mastra-file-agents`, `tailwind-to-stylex`.

From `.agents/skills/` in that repo: `docs-i18n-zh`, `skill-creator`, `unslop`, `writing-great-skills`.
