# Firstmate + Cursor

[Firstmate](https://github.com/kunchenguid/firstmate) is Kun Chen's agent distro: an orchestrator home (`AGENTS.md`, `bin/`, bundled skills) that runs a crew of workers. It is not a Cursor plugin.

## What is installed here

Skill-bearing [kunchenguid](https://github.com/kunchenguid) repos install into the machine-wide set at `~/.agents/skills/` (symlinked into `~/.cursor/skills/`). This repo does not mirror them.

Project skills are committed under `.agents/skills/`. The list and upstream commits are in [`.agents/skills/SOURCES.md`](../.agents/skills/SOURCES.md).

The global set includes:

- **firstmate**: `afk`, `bearings`, `stow`, `harness-adapters`, and the no-mistakes pipeline hooks
- **axi family**: `axi`, `gh-axi`, `chrome-devtools-axi`, `lavish` / `lavish-design`, `quota-axi`, `tasks-axi`
- **workflows**: `no-mistakes`, `gnhf`, `whathappened`, `stow`

## Firstmate home (orchestrator)

```sh
# already cloned on this machine:
cd ~/firstmate
# launch a verified primary harness:
claude          # or: grok --trust   or: pi
```

Verified primary harnesses: **Claude Code, Grok, Pi / pi-signed, Codex, OpenCode**.

Cursor is **not** a verified firstmate primary or crewmate adapter. Use Cursor for IDE work with the skills above; run firstmate itself from `~/firstmate` on a verified harness.

Captain notes: `~/firstmate/config/README.cursor.md`.

## Suggested split

1. **Cursor** on PubMax — edit, review, run skills (`/stow`, axi helpers, no-mistakes, …).
2. **Firstmate** in `~/firstmate` — captain session that clones/spawns crewmates for multi-agent ship work.
3. Optionally add PubMax under `~/firstmate/projects/` so the first mate can dispatch verified-harness crewmates against it while you keep Cursor open on the same tree.

## Reinstall

```sh
npx skills add kunchenguid/firstmate -g -a cursor --all -y
npx skills add kunchenguid/no-mistakes -g -a cursor --all -y
npx skills add kunchenguid/axi -g -a cursor --all -y
# other kunchenguid skill repos install the same way, into ~/.agents/skills
```
