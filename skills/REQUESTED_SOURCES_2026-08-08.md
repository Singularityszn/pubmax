# Requested skill sources (2026-08-08)

Installed **project-level for Cursor** into `.agents/skills/` (committed) and linked from `.cursor/skills/`.

| Source | Repos installed | Notes |
|--------|-----------------|-------|
| [mattpocock](https://github.com/mattpocock) | `mattpocock/skills` | Full pack (~35) |
| [kunchenguid](https://github.com/kunchenguid) | firstmate, lavish-axi, no-mistakes, short-pipe, acpx, programbench-bench, gnhf, whathappened, simplewords, baby-menu, m87, axi, quota-axi, tasks-axi, chrome-devtools-axi, gh-axi, rough-cut-axi | Every public repo with a `SKILL.md` |
| [petergyang](https://github.com/petergyang) | `no-ai-slop`, `human-review` | Skill-bearing repos |
| [google-labs-code/design.md](https://github.com/google-labs-code/design.md) | `tdd-red-green-refactor`, `typed-service-contracts`, plus `ink`, `agent-dx-cli-scale` | Spec format lives in upstream `DESIGN.md` / docs |
| [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) | same + `oklch-skill` + `jakubkrehel/skills` (better-*) | Full interface craft pack |
| [ryokun6/ryos](https://github.com/ryokun6/ryos) | create-ryos-app, create-store, desktop-release, localize, react-best-practices, ui-design-styling, update-docs, write-api-route, write-tests, … | ryOS app skills |

## See them in Cursor

1. Pull this branch
2. Quit/reopen Cursor or open a **new** Agent chat
3. **Customize → Skills**, or `/ask-matt`, `/no-ai-slop`, `/better-ui`, `/make-interfaces-feel-better`, `/create-ryos-app`

Details: [`docs/WHERE_ARE_THE_SKILLS.md`](../docs/WHERE_ARE_THE_SKILLS.md)

## Merge note (main, 2026-08-08)

While merging `main`, several top-level `skills/<name>` paths were **add/add** conflicts where `main` and this branch shipped different skill bodies under the same folder name. Resolution kept this branch (requested-source installs under `.agents/skills/`).

| Name | This branch (kept) | `main` (displaced at top-level) |
|------|--------------------|----------------------------------|
| `prototype` | Matt Pocock throwaway prototype | Emil Kowalski multi-variant picker (still at `skills/emilkowalski-skills/skills/prototype/`) |
| `react-best-practices` | ryOS / Vercel performance guide | ECC TSX quality checklist |
| `backend-patterns` | Kenji fuller backend pack | ECC short backend patterns |
| `design-system` | Kenji design-system pack | ECC design-system audit |
| `make-interfaces-feel-better` | jakubkrehel upstream | shorter community vendored copy |

Cursor discovery uses one folder name under `.agents/skills/` / `.cursor/skills/`, so only one body can win per name.
