# R31 freshness, dependency handoff and acceptance

Work on 30 September 2026 added production read evidence and one reviewed dependency patch. No local app, browser, test suite, database, build or installation ran. No index, commit, push, account mutation, cron, production migration or deployment occurred.

## Production freshness is measurable

[Public freshness receipt](r31-public-freshness-read.json) records HTTP 200, edge MISS, age 0 at 17:08:39 UTC. The server generated the report at 17:08:39.230 UTC. It reports 27 feeds: four fresh, eight snapshots, five untracked, seven unmeasured, two retired and one stale.

| Feed | Actual reported stamp | Status |
| --- | --- | --- |
| Weather | Durable store, 30 September 16:05:38 UTC | Fresh, age 1.1 hours |
| What's On | Durable store, 30 September 15:00:00 UTC | Fresh, age 2.1 hours |
| Night-signal candidates | Durable store, 30 September 05:15:52 UTC | Untracked, age 11.9 hours |
| Area news | Committed artifact, 28 August 07:05:17 UTC | Stale, age 802.1 hours against a 504-hour budget |

The three local keyless unmeasurable-store warnings therefore do not establish production outages. An untracked stamp does not prove current admitted claims. The seven unmeasured live provider lanes still need their own probes. The community-price count is zero corroborated categories with degraded=false; it is a reported count, not proof that every price-write path works.

[Consumer reads](r31-public-feed-consumer-reads.json) at 17:14 UTC returned empty ready area-news responses for Hackney and Camden, both no-store. Tonight Conditions returned a nonstale weather answer with a one-hour-old checked label. This is anonymous API evidence, not native rendered-page proof.

## News is withheld, but stale coverage is hidden

Source review found 97 committed area-news entries, newest observed on 21 August. `freshAreaNews` in `lib/areaNews.ts:274` admits dates from UTC midnight minus 21 days through today, inclusive. At the 30 September cutoff, no committed story qualifies. API and borough-page consumers filter before rendering, so fresh reads do not paint these old stories.

The loader at `lib/areaNews.server.ts:45` returns ready independently of generatedAt age; the API omits that stamp. An expired-only dataset becomes ready with an empty list. Plan and borough components say "No current updates here"; Map and Tonight rails disappear. That hides stale coverage, although it does not claim an expired story is current. A long-lived mounted client also lacks an expiry recheck until area or venue changes. That second case is a source possibility without a native reproduction.

This disclosure issue is lower priority than the observed bad beer API claim and source-traced private plan field. No dataset was restamped or refreshed to hide its age.

## Printed spirit serving is lost

Both keyless and judged harvest paths assign servingSize only through wine-specific identity parsing. Wine category headings are tracked, but serving measures are not inherited from headings. Existing tests cover inline wine measures, adjacent wine glass prices and refusing identity inheritance across separate items; inspected tests do not cover explicit spirit measures.

Brownswood's retained ledger row 421 and served bundle row 1657 contain a gin price of £4.20 with label `Gin ~ 25 ml Sacred` and no servingSize. The builder copies only an existing serving field. PublishedMenuPrices therefore displays "Serving not recorded" even though 25 ml survives in the record's text. This is a source-traced presentation and comparison gap; no native gin-panel RED has been captured.

Preserve explicitly printed item measures. Section inheritance is a separate producer problem requiring heading resets, item overrides and sibling isolation. Never supply generic 25 ml or 175 ml defaults. Core's retained-record/read-boundary work must be separate from integration's future parser work; future parsing alone cannot enrich these old rows.

## Plan feed connections need owner review

`lib/planGeneration.server.ts:57–58,325–326` imports committed weather and night-signal snapshots. The committed weather observations expired on 3 September. Current-time planning rejects them through planningWeatherForArea even though production's durable weather store is fresh. The public night-signal reader merges approved durable claims, whereas this generator input uses the committed snapshot alone.

Explicit future-route weather omission in `lib/planGenerationTemporalEvidence.ts:101–103` is deliberate: a current observation is not a forecast. Preserve it. No current live hazard, incorrect rendered plan or new forecast requirement is established by the source contrast. The integration owner must review and reproduce any missing durable-feed connection before a shared generation-module edit. Root did not call the public night-signal endpoint, whose GET can broadcast push messages.

## Reviewed dependency patch applied

SDK published the minimal DOMPurify repair at fe0cabf5fe26d5eb45af47863d21051442e9d075. Its owner recorded fresh full gate session 6060 exiting 0, then actual runtime release at 17:09:36.959309 UTC. [Independent OS check](r31-sdk-cleanup-check.json) at 17:12 found no survivors among its 128 recorded PIDs and 94 groups, and no listeners on the five recorded ports. No new Core runtime grant follows from this release.

After explicit source handoff, Core applied only the DOMPurify version, tarball URL and integrity fields. [Patch receipt](r31-core-dependency-patch.json) proves the target entry equals published SDK, every other package entry and top-level field stayed intact, and the R28 4,247-file freeze differs only at package-lock.json. Existing AI, OpenTelemetry and PostHog edits were preserved.

Core's lock now says 3.4.16; installed DOMPurify remains 3.4.15. The patch is not installed or tested here. R28's gate and build are historical evidence. The next granted runtime must install the exact lock with scripts disabled, prove the actual installed version, freeze the new candidate and build it before any browser or full gate.

## Full v0 acceptance remains open

The Astra subagent rechecked `docs/plans/Astra.md`, SHA-256 9f164269abb2bc4e7f7d096ea51dc510423ede146b0b3f2226985c7108674724. It remains a historical 7 September handoff and names PlanAstra as its replacement for recommendations. Old counts, production SHA and completed planning documents do not prove current acceptance.

| Requirement | Latest bounded evidence | Still required |
| --- | --- | --- |
| Integrated Map, Places, Plan and Create journeys | Focused UI proofs and R28 five affected-case passes | Fresh original full-five regression; full picker and visual journey coverage |
| Account usability and identity separation | Auth doubles, responsive UI proofs, anonymous R30 headers and nonce matching | Real provider sign-in, sign-out and account switching; authenticated cache isolation |
| Trustworthy all-alcohol prices | Named-category source/tests, Sydney measured wine journey, publisher/API contradiction | Native bad-claim RED, exact existing-record repair, measure/category coverage and durable bill/price write-read |
| Plan privacy | R30 retained anchorVenueId path in anonymous client props | Native anchored-plan RED, repair and member/anonymous/offline regression |
| Performance | Historical 47-route resource pass; strict default-five CWV was red | Fresh strict CWV and resource gates after changes; controlled pin-ready timing |
| Security and maintenance | Disposable RLS, anonymous headers, reviewed DOMPurify lock patch | Exact installed dependency and new full gate; production posture and dashboard settings evidence |
| Plain, coherent UI and lean code | Voice/design fences, focused viewport proofs | Full-product visual review and justified bloat cleanup; 17 complexity warnings remain |
| Adopted repeating-group measurement | Source and disposable PostgreSQL aggregation | Actual live migration/reporting evidence, separate from client consented-device proxy |

AI 7.0.123 and OpenTelemetry 1.0.123 already passed the earlier R28 gate; R19's queued patch notes are stale. TypeScript 7 remains incompatible with the current parser peer range. Earlier 11.1-second pin timing is a historical observation; no improvement is proved by ordering or lifecycle source changes alone. Relevant GNHF skill mirrors were updated earlier; a whole installed-skill duplication/update audit is not proved by that patch.

Do not turn unadopted social, onboarding, image-rights, notification, Rounds, launch or city-expansion recommendations into v0 acceptance. Preserve London-first supply and actual named requirements. The goal remains active. Next Core runtime prioritises native price and anchored-plan reproduction, repairs, a new freeze and full gates.
