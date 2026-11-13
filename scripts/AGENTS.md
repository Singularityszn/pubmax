# CLIs, harvest, gates and deploys

Commands: the harvest lanes, the builders and publishers, the quality gates and the deploy scripts. `lib/harvest/*` follows this file. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **Nothing is fetched without permission.** `lib/harvest/sourcePolicy.ts` is the fence in front of every harvested URL. No caller passes it a URL of its own. Ask the allow-list about the URL you landed on after redirects.
- **A price source is fenced like every other source.** The narrower price governance table binds.
- **A page that names another branch is not this pub's price.** A shared name is not a match. An Exa website is read for a price only when its own page states the pub's address.
- **The Wetherspoon directory is never edited by hand.**
- **Harvest spend is capped in code.** This covers the London Tavily pass and the London promotion. Every row keeps its evidence.
- **Knip is the dead-code gate.** Every ignore names the caller knip cannot see.
- **Every gate is run by something.** A gate that nothing runs is not a gate.
- **An audit waiver is a documented exception, not a mute button.** `scripts/resilient-audit.mjs` waives only advisories in `WAIVED_ADVISORIES`, each with a reason and a removal condition.
- **Generated database types come from the harness cluster.** `verify` refuses drift.
- **A deploy uploads the working tree, not the commit.** `.vercelignore` replaces `.gitignore` for an upload, so a heavy folder missing from it is uploaded.
- **A production release is one command, and the captain decides it.** It refuses when production lacks a migration, and it ends at the smoke verdict.
- **The database backup is a private copy on the captain's Mac.** It is never a workflow artifact.
- **A builder refuses rather than rewrites.** A slim rebuild that drops a shipped famous venue fails.

## Detail

Read a detail file only for the rule you change. Each holds the full rules, pins and history:

- CI, gates and audits: [`docs/rules/scripts-ci-gates-and-audits.md`](../docs/rules/scripts-ci-gates-and-audits.md)
- Harvest and source permission: [`docs/rules/scripts-harvest-and-source-permission.md`](../docs/rules/scripts-harvest-and-source-permission.md)
- Builders and publishers: [`docs/rules/scripts-builders-and-publishers.md`](../docs/rules/scripts-builders-and-publishers.md)
- Deploys and uploads: [`docs/rules/scripts-deploys-and-uploads.md`](../docs/rules/scripts-deploys-and-uploads.md)
