---
name: firecrawl
description: |
  Firecrawl gives AI agents fast, reliable web context: search, scrape, interact,
  crawl, and workflow deliverables. Use for PubMax pub-menu price research
  (Greene King, Mitchells & Butlers, Young's), competitor intel, and any live
  web data task. Route to firecrawl-build skills for app integration; firecrawl-workflows
  for finished artifacts (research briefs, lead lists, QA reports).
allowed-tools:
  - Bash(firecrawl *)
  - Bash(npx firecrawl *)
---

# Firecrawl (PubMax)

## Install (one-time per machine)

```bash
npx -y firecrawl-cli@latest init --all -k "$FIRECRAWL_API_KEY"
```

Global skills land under `~/.cursor/skills/` and `~/.agents/skills/`. This repo
also vendors the umbrella skill at `skills/firecrawl/` for project context.

## Credentials

Set in `.env.local` (gitignored):

```dotenv
FIRECRAWL_API_KEY=fc-...
```

Verify:

```bash
mkdir -p .firecrawl
npx -y firecrawl-cli@latest --status
npx -y firecrawl-cli@latest scrape "https://firecrawl.dev" -o .firecrawl/install-check.md
```

## PubMax pub price scraping

**Governance:** Only first-party chain/venue menus in `data/price_sources.json`
(`permissible: true`). Never scrape aggregators (pint-prices.com, Vivino, etc.).

| Priority | Chain | Menu pattern |
|----------|-------|--------------|
| 1 | Greene King | `greeneking.co.uk/pubs/greater-london/{slug}/menu` |
| 2 | M&B (Nicholson's, O'Neill's, Toby, Harvester) | `*/restaurants/london/{slug}/drinks` |
| 3 | Young's | `{pub-domain}/food-and-drinks/` |
| — | Wetherspoons | No per-pub web prices (app-only); monitor only |

**Run Greene King batch scrape:**

```bash
node scripts/firecrawl_greene_king_prices.mjs --limit 20
node scripts/firecrawl_greene_king_prices.mjs --urls-file data/greene_king_london_menu_urls.txt
node scripts/firecrawl_mbplc_prices.mjs --limit 43
node scripts/apply_drink_price_updates_to_dataset.mjs
```

Outputs: `public/data/drink_price_updates/latest.json` (sourced rows with
`observedAt` + licence). Raw scrapes go to `.firecrawl/menus/` (gitignored).

## Live web workflow

1. **Search** — discovery (`firecrawl search "…" --scrape --limit 5`)
2. **Scrape** — known URL (`firecrawl scrape "<url>" -o .firecrawl/page.md`)
3. **Map** — find subpages (`firecrawl map "https://site" --search "menu"`)
4. **Interact** — tab clicks / pagination when scrape is incomplete
5. **Crawl** — bulk docs sections

Write outputs to `.firecrawl/` with `-o`. Add `.firecrawl/` to `.gitignore`.

Full onboarding paths (CLI, build, workflows, auth): https://www.firecrawl.dev/agent-onboarding/SKILL.md
