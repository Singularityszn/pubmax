# Where are the skills?

## Short answer

Pull this branch, then in Cursor:

1. Open **Customize → Skills** (or Settings → Rules → Agent Decides)
2. Or type `/` in a **new** Agent chat and search the skill name

Try: `/ask-matt`, `/grill-me`, `/tdd`, `/afk`, `/bearings`, `/last30days`

## Why you could not see them before

| What we did earlier | Why Cursor hid it |
|---------------------|-------------------|
| `npx skills add … -g` on the cloud agent | Installed into the **cloud VM home**, not your laptop |
| Mirrored files under top-level `skills/` | Cursor **does not** scan `skills/` |
| `.agents/` was gitignored | Even project installs never reached git / your machine |

Cursor only loads project skills from:

- `.agents/skills/` ← **now committed** (Matt Pocock, Kenji, kunchenguid, last30days, …)
- `.cursor/skills/` ← **now committed** (symlinks to every `skills/<name>` mirror)

## Pack map

| You asked for | Skill examples | Path |
|---------------|----------------|------|
| Matt Pocock | `ask-matt`, `grill-me`, `tdd`, `to-spec`, `implement` | `.agents/skills/` + `.cursor/skills/` |
| Kenji | `workflow-pr`, `audit-security`, `thirdparty-*` | same |
| kunchenguid / Firstmate | `afk`, `bearings`, `stow`, `acpx`, `lavish` | same |
| Matt Van Horn | `last30days` | same |

Full list: [`INSTALLED_SKILLS.md`](../INSTALLED_SKILLS.md) and [`.cursor/skills/README.md`](../.cursor/skills/README.md).

## If they still do not appear

1. Confirm you are on branch `cursor/install-mattpocock-kenji-skills-44b7` (or main after merge).
2. Confirm folders exist: `.agents/skills/ask-matt/SKILL.md` and `.cursor/skills/ask-matt`.
3. Fully quit Cursor and reopen the project (skills are discovered at startup).
4. Start a **new** Agent chat — old chats keep a stale skill list.

## Packs installed 2026-08-08

| Source | Try in chat |
|--------|-------------|
| Matt Pocock | `/ask-matt`, `/grill-me`, `/tdd` |
| kunchenguid | `/afk`, `/bearings`, `/gnhf`, `/no-mistakes` |
| Peter Yang | `/no-ai-slop`, `/human-review` |
| google-labs-code/design.md | `/design-md`, `/typed-service-contracts` |
| Jakub Krehel | `/make-interfaces-feel-better`, `/better-ui`, `/better-interface` |
| ryokun6/ryos | `/create-ryos-app`, `/ui-design-styling` |

Catalog note: `skills/REQUESTED_SOURCES_2026-08-08.md`
