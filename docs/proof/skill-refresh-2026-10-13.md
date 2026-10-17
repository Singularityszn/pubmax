# Installed skill refresh, 13 October 2026

This dated receipt records a refresh of eight installed skills and three supporting references.
It does not establish application behaviour or launch readiness.

## Upstream sources

| Official repository | Recorded base | Refreshed tip |
| --- | --- | --- |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | `b482f7a970abb98c4108d4a9f761e458c64cefc8` | `d237dd399d57524945c0c81327da5da19f7a468d` |
| [jakubkrehel/skills](https://github.com/jakubkrehel/skills) | `d574cc8a576dc24256ad38268b8d03d86724a1b3` | `4c66b1fa86e9ab70187b43d7da9b6fdb29f2ef63` |
| [elevenlabs/skills](https://github.com/elevenlabs/skills) | `1d08a4a250cff67cc8056ec31587c031ecb06d2f` | `0e371300354872fbb8ee375f04cf518e9a335ca5` |

The tips were read from fresh clones of the official repositories.
Each changed installed file was merged with `git merge-file` using its recorded upstream base.
All eleven merges completed without conflicts.

## Changed file manifest

All paths below are relative to `.agents/skills/`.

| Installed skill | Changed files | Upstream change |
| --- | --- | --- |
| `brandkit` | `brandkit/SKILL.md` | Preserves existing brand assets and requested canvas dimensions. |
| `gpt-taste` | `gpt-tasteskill/SKILL.md` | Adds reduced-motion guidance. |
| `minimalist-ui` | `minimalist-skill/SKILL.md` | Adds reduced-motion guidance. |
| `redesign-existing-projects` | `redesign-skill/SKILL.md` | Keeps collapsed desktop navigation named, visible and operable. |
| `design-taste-frontend` | `taste-skill/SKILL.md` | Corrects animation examples, resize measurements and reduced-motion access. |
| `state-machine` | `state-machine/SKILL.md`, `state-machine/switcher.md` | Groups states beside the component and uses a select on narrow screens. |
| `variant` | `variant/SKILL.md`, `variant/picker.md` | Groups variants beside the component and uses a select on narrow screens. |
| `elevenlabs-agents` | `elevenlabs-agents/SKILL.md`, `elevenlabs-agents/references/using-procedure-api.md` | Corrects compilation and validation guidance for agent draft saves. |

## Preserved local content

- The `state-machine` Next.js server/client boundary paragraph is byte-identical to the installed version before the refresh.
- The `elevenlabs-agents` discovery name remains namespaced.
- All eight frontmatter blocks remain byte-identical to their installed versions before the refresh.
- Custom PUBMAXX skills, other local corrections and untracked directories were not changed.
- `.agents/skills/SOURCES.md` remains unchanged because the open performance snapshot owns that file.
- Existing ElevenLabs installation guidance remains unchanged, including the removal of shell-pipe installation blocks.

## Validation

- The changed-path manifest contains exactly eleven skill files across eight skill trees.
- All 19 files in the eight target trees match upstream except the three recorded local corrections.
- YAML parsing, required names, required descriptions and existing invocation metadata checks passed for all eight skills.
- The installed discovery-name scan found 88 unique names and no duplicates.
- All 20 relative links in changed skill files resolve to existing local files.
- Conflict-marker and local-correction preservation checks passed.
- `git diff --check` passed.

The skill-creator quick validator passed directly for five skills.
Its schema rejects the unchanged `disable-model-invocation` field in `state-machine` and `variant`.
It also rejects the unchanged `compatibility` field in `elevenlabs-agents`.
Those three skills passed content validation in temporary copies with only those fields removed.
The installed files retain their original metadata, which was parsed and checked separately.

Application tests, builds and the full `npm run verify` gate were not run for this documentation-only refresh.
