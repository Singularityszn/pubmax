# Area news refresh

`data/area_news.json` holds dated London pub news (openings, closures, refurbishments, awards and price sightings), each with a real `sourceUrl` and an `observedAt` date. `lib/areaNews.ts` (`freshAreaNews`) serves a fact only for 21 days after its `observedAt`. `/api/area-news` and the borough pages read the facts through that filter, so once the newest fact is older than 21 days they show nothing.

## Where it stands (checked on 2026-10-23)

| | |
| --- | --- |
| Entries in the file | 96, observed 2026-05-19 to 2026-09-15 |
| Servable today | 0. The newest fact (2026-09-15) left the 21-day window after 2026-10-06. |
| Freshness stamp | `latestObservedAt` 2026-09-15. The spine dates the newest fact, rather than the file generation time. |
| Gate | The 528h budget has expired. `check:freshness` reports advisory stale and exits successfully when no other lane fails. |
| Latest refresh attempt | Six searches and 36 page fetches returned no valid facts. The producer preserved the dataset. |

The fresh-facts layer has been empty since 7 October. A successful freshness command does not establish that this advisory feed has fresh facts.

## Who can do this

Anyone who can reach `api.keenable.ai`. `KEENABLE_API_KEY` is optional: without it the job uses Keenable's public endpoint. The agent cloud containers cannot run it, because their network policy refuses that host.

## Steps

1. Start from fresh `main` on a new branch.
2. Run `npm run refresh:area-news`. It searches the previous and current month for London pub openings, closures, refurbishments, awards and price sightings, reads each candidate page, and keeps one dated fact per page published in the last 21 days. Earlier rows stay in the file as archive. `--max-results` (default 8 per query) and `--max-candidates` (default 36) widen or narrow the sweep.

   Search stops when the producer collects `--max-candidates` distinct accepted URLs. Remaining queries cannot add candidates and are not sent.

   The run is all or nothing. Any failed page fetch, or no valid fact at all, throws and leaves the file unchanged, so re-run it. A good run ends with `READY area news: N fresh facts from M candidates, 0 fetch failures, T total archive rows`.
3. Review every new entry in the diff against its `sourceUrl`:
   - The page says what `title` and `detail` say.
   - `observedAt` is the page's own date.
   - `area` is the right neighbourhood.
   - A self-reported price sighting is marked `confidence: "social"`. It is texture for the news layer, never a Pint Index input.

   If an entry fails review, correct the producer's validation and regenerate the file. Do not edit the generated dataset by hand.
4. If a new fact names a pub that should link to its venue, add it to `MATCH_TARGETS` in `scripts/build_area_news_matches.mjs` and run `node scripts/build_area_news_matches.mjs`. Skip this when no badge needs adding.
5. Check that the facts are servable. This count ignores the per-entry validation, so treat it as a rough check:

   ```
   node -e 'const a=require("./data/area_news.json");const c=new Date(Date.now()-21*864e5).toISOString().slice(0,10);console.log(a.entries.filter(e=>e.observedAt>=c).length)'
   ```

   Then run `npm run check:freshness`, `npm run validate-data` and `npx vitest run __tests__/areaNews.test.ts __tests__/areaNewsLoader.test.ts __tests__/refreshAreaNews.test.ts __tests__/checkFreshnessAreaNewsAdvisory.test.ts`.

The provider and the serverless limits are described in `docs/CRON_PLANE_RUNBOOK.md`.

## Next time

Each fact serves for 21 days from its own date, however new the file is. Refresh at least every two weeks, so a fresh fact lands before the newest one leaves the window.
