# Local stale-feed repair, 23 October 2026

The user assigned stale feeds to this branch. Another chat owns moderation and routing.
The base is `d64a5cf0474407d51c7d2b521a7337c2c3f8c663` on `codex/freshness-audit-repair-1023`.

## Refresh failure and fix

The area-news producer continued searching after collecting its candidate limit.
Those later searches could not contribute a URL. A later provider error still stopped the refresh before it could fetch the collected candidates.

The producer now stops searching when it reaches the limit.
The regression calls `refreshAreaNews` with one accepted URL and a provider that fails on any later search.

| Check | Before | After |
| --- | --- | --- |
| Regression | Throws `Area news search failed for "unneeded": provider unavailable` | Writes one validated fact, dated 2026-08-27, after one search |
| Real CLI, `--max-results 2 --max-candidates 2` | Six searches, two fetches | One search, two fetches |
| No valid facts | Preserves the existing dataset | Preserves the existing dataset |

The focused command passed 94 tests across nine files:

```sh
npx vitest run __tests__/refreshAreaNews.test.ts __tests__/keenableAreaNews.test.ts __tests__/placesEnrichmentRunner.test.ts __tests__/placesFreshnessLead.test.ts __tests__/areaNewsFreshnessStamp.test.ts __tests__/areaNews.test.ts __tests__/areaNewsLoader.test.ts __tests__/areaNewsRouteUnavailable.test.ts __tests__/checkFreshnessAreaNewsAdvisory.test.ts
```

`npm run verify` exited 0. The checks passed data validation, lint, database type generation, TypeScript, eight MCP tests, dead-code checks, coverage, PostgreSQL tests, skip policy, freshness policy, install policy, and dependency audit.
Coverage passed 43,401 tests across 2,101 files. The optional Context.dev live test was skipped because `CONTEXT_DEV_API_KEY` was absent.
PostgreSQL passed 681 tests across 74 files, followed by all ten serial shared-memory tests.
Verification rebuilt derived venue files. Those generated changes were restored, leaving the committed datasets unchanged.

## Feed state

The full `npm run refresh:area-news` attempt made six searches and 36 page fetches.
All requests completed, but no extracted fact passed validation. The command exited 1 and preserved the dataset.

The Packington article describes a 25 September opening, outside the serving window.
The Prince Albert article describes a November reopening, outside the current-event window.
Other inspected extraction responses returned `null` or no mapped area. These findings do not justify inventing dates or relaxing validation.

`node scripts/check_freshness.mjs --artifacts-only` reports two advisory stale feeds:

| Feed | Source date | Budget | Local finding |
| --- | --- | --- | --- |
| `area_news` | 2026-09-15 | 528h | No current facts can be served |
| `google_places_content` | 2026-10-04 | 384h | The 16-day refresh warning has started. Copied hours expire after 30 days. |

The Places previews made no external requests:

```sh
npm run enrich:google-places -- --dry-run --refresh
npm run enrich:google-places -- --dry-run --refresh --pack=uk_cities
```

London has 3,053 pending rows. October's remaining USD 23.94 covers 1,197 requests and omits 1,856 rows.
The UK-city preview plans zero requests because its shared USD 28 task cap is exhausted.
Both extras previews exit 1 with `nothing to refresh`.

The documented npm command starts correctly. Running the script through plain Node without the configured `tsx` loader fails to resolve TypeScript aliases.

## Scope

No deployment, GitHub push, production settings change, paid Places request, or production database write was performed.
The Places writer temporarily changes Google daily quota overrides, so it was not run.
The news dataset and the Places packs retain their original dates and contents.
