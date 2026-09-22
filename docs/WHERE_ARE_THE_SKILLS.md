# Find an agent skill

Use the active harness's skill catalogue first. Read only the matching `SKILL.md`,
then files it explicitly requires for the current task. A catalogue is an index,
not instructions to load every skill.

Project entry points are `.agents/skills/` and `.cursor/skills/`. The committed
`skills/` directory also holds source mirrors. Harness discovery differs; check
what the active harness actually exposes rather than assuming every mirror is loaded.

For a local lookup, substitute a topic in this bounded search:

```sh
rg -l -i 'review|verification' .agents/skills skills --glob SKILL.md | head -20
```

Inspect the selected path before applying it. If a named skill is absent, search
shared installed skills once; report a missing dependency instead of installing an
entire collection. Resolve symlinks before changing a skill and preserve aliases
used by another harness.

The historical [installed catalogue](agents/INSTALLED_SKILLS.md) is a generated
snapshot, not proof of current installation. Search it only when local discovery
cannot locate a named skill. Do not load it wholesale into task context.

Cursor mirror links can be rebuilt with `node scripts/link-cursor-skills.mjs`.
After installation, refresh the harness's skill discovery or start a new session.
See [Cursor project skills](../.cursor/skills/README.md) for that mirror layout.
