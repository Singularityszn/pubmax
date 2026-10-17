# Research nobody publishes

Rows researched the way `../london.json` is, for places the app does not cover
yet. Nothing reads this folder: `npm run ingest:hyped-pubs` reads one city file
and `/tonight` reads only `public/data/hyped/london.json`. A row here is
evidence kept for later, never a pub on a page.

| File | What it holds |
| --- | --- |
| `kent-surrey-borders.json` | Kent and Surrey towns just past the Greater London boundary. Each row adds `county`, `kind` (`new` or `hidden-gem`) and a reviewer `note`. |

Publishing any of it is a product decision, not a data one: the repo-wide laws
say London density comes before any multi-city splash
([AGENTS.md](../../../AGENTS.md)). The row rules in
[the hyped-pubs README](../../../public/data/hyped/README.md) still apply, so a
row whose freshest source is older than 120 days is re-researched before it
could be used.
