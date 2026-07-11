FAQ | ImpeccableSkip to content
[Impeccable](/)
[Home](/)[Designing](/designing)[Docs](/docs)[Slop](/slop)[Live](/live-mode)[40k](https://github.com/pbakaus/impeccable)

Support

Frequently Asked Questions

Installation, updates, troubleshooting, and the questions newcomers ask first. Each answer is deep-linkable.

Where do I put the downloaded files?

The easiest way is `npx impeccable install`, which shows the harness folders it detected, lets you keep or customize the provider list, and asks whether to install in the current project or globally. Use `--scope=project` or `--scope=global` for non-interactive installs.

If you downloaded the universal ZIP, extract it to your project root (same level as your `package.json` or `src/` folder). It creates hidden folders for each supported tool: `.cursor/`, `.claude/`, `.gemini/`, `.codex/`, `.agents/`, and `.github/`.

Project-level installation takes precedence and lets you version control your skills.
How do I update to the latest version?

Run `npx impeccable update` from your project root. It downloads the latest skills and cleans up deprecated files. Not sure you're behind? `npx impeccable check` compares what you have installed against the latest release first.

Reinstall:`npx impeccable install --force` installs fresh.

Claude Code plugin: Open `/plugin` in Claude Code.

npx skills:`npx skills add pbakaus/impeccable` also works, but installs one shared build for all harnesses rather than the one compiled for yours.

Manual ZIP: Download from the homepage and extract to the project root.

Your `PRODUCT.md` and `DESIGN.md` context files are never overwritten.
I used to type `/critique` directly. How do I get that back?

Pinning is built in. Run `/impeccable pin critique` and `/critique` becomes a standalone shortcut again, without reversing the consolidation.

Under the hood it writes a lightweight redirect skill that delegates to `/impeccable critique`, so updates to the parent skill flow through automatically. It works for every command.

Examples:

`/impeccable pin polish` → `/polish` works again

`/impeccable pin audit` → `/audit` works again

`/impeccable pin live` → `/live` works again

To remove: `/impeccable unpin critique`. To see your current pins, check your harness skills directory (`.claude/skills/`, `.cursor/skills/`, etc.) for directories named after the command you pinned, like `.claude/skills/critique/`.
Commands or skills aren't appearing. What do I do?

For commands: Type `/impeccable` in your AI harness and look for commands like `/impeccable audit`, `/impeccable polish`, etc. If they don't appear, double-check the files are in the correct location.

For skills: Skills are applied automatically when relevant. To verify, explicitly mention "use the impeccable skill" in your prompt. This forces the AI to acknowledge and apply it.

Tool-specific setup:

Cursor: Requires Nightly channel + Agent Skills enabled in Settings → Rules

GitHub Copilot: Skills install to `.github/skills/`. The design hook lives in `.github/hooks/impeccable.json` and runs in both the Copilot CLI and the cloud agent once it is committed to the repository's default branch.

Gemini CLI: Requires `@google/gemini-cli@preview` + Skills enabled via `/settings`

Codex: Skills do not appear in the normal `/` command picker. Open `/skills` or type `$`. Repo installs live in `.agents/skills/`, user installs live in `~/.agents/skills/`. Restart Codex if a new skill does not show up.
I'm new to AI harnesses. Where do I start?

Skills and commands are intermediate features. If you're just getting started, learn the basics first:

Claude Code:[Official Documentation](https://docs.anthropic.com/en/docs/claude-code)

GitHub Copilot:[GitHub Copilot Docs](https://docs.github.com/en/copilot)

Cursor:[Cursor Docs](https://docs.cursor.com)

Gemini CLI:[Gemini CLI Docs](https://geminicli.com/docs/)

Codex CLI:[Codex GitHub](https://github.com/openai/codex)

Once you're comfortable with basic prompting and code generation, come back and give Impeccable a try.
Is Impeccable free?

Yes. Everything is Apache 2.0: skills, commands, CLI, and the detection engine. Fully open source, free for everyone.

[Impeccable](/)[Changelog](/changelog)[FAQ](/faq)[Privacy](/privacy)[GitHub](https://github.com/pbakaus/impeccable)
Created by [Paul Bakaus](https://x.com/pbakaus)[](https://x.com/pbakaus)[](https://linkedin.com/in/paulbakaus)