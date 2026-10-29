# UK execution pack: first implementation slice

This record covers the attached 29 October pack. UK research remains separate from London releases.
No deployment, migration, live flag, outreach, paid service or analytics definition change is authorised by this record.

## Code and deployment

- The worktree started from `origin/main` at `082e181db4210512108f52bd693725a0173de0df`.
- The original main checkout was `5c635110e226c8c1eb3cc22445c36904064b5a88`. Its unrelated skill edits remain untouched.
- The production version endpoint returned `e5da6c072d378e8f94bfa8e841f805a801e697a3` and deployment `dpl_4V9F76kkj68fRB7DvxPDXErfTa9o`.
- Production and source inspection are separate observations. This branch is not deployed.

## Reconciliation and task status

| Pack task | Status in this change | Existing code, implementation or dependency |
| --- | --- | --- |
| BASE-01 | Implemented for this selected slice | Existing menu, planner, crew, source, freshness and analytics owners were inspected. No replacement services were added. |
| MEASURE-01 | Partial | The connected PostHog baseline was repeated. Search Console has no available connector or repository script in this session. Search rankings and Google indexation remain unmeasured. |
| MEASURE-02 | Implemented documentation correction | `METRICS_FUNNEL.md` separates creation from the crew milestone and corrects the historical viral-coefficient label. `analytics/METRICS.md` excludes completions without a crew-status field from that ratio. No live reports changed. |
| DATA-01 | Already present | `harvest/sourceRegistry.ts`, `harvest/sourcePolicy.ts` and `data/SOURCE_LEDGER.md` own access. The competitor register grants no fetch rights. No source was added. |
| PRICE-01 | Implemented bounded contract | `outingQuote.ts` validates GBP pennies, selected item identity, serving, branch, source, observation/retrieval dates and exact offer instances. Existing menu records remain unchanged. |
| PRICE-02 | Partial | Deterministic eligible/ineligible/unknown checks cover branch, exact validity/service intervals, party size, selected items, membership, booking and availability. Unresolved material terms cannot qualify. Recurring rules, nation-specific holiday resolution, provider inventory, voucher allocation and mixed membership groups remain dependent work. |
| PRICE-03 | Implemented bounded calculator | Integer arithmetic includes fixed fees, explicit service bases, full new membership commitments and explicit fee payment timing. Refundable deposits and cashback remain separate. Unknown material components suppress the full total. |
| DATA-03 | Partial, existing policy reused | The calculator uses `PRICE_AUTHORITY_MAX_AGE_MS`. Retrieval cannot renew an observation. Conflict, stale, missing and provider-error answers remain distinct. No refresh job changed. |
| UX-01 | Partial | The venue Menu tab offers food/drink quantities and a dated menu subtotal. Existing menu data does not prove complete fees, tax, deposits or availability. The UI therefore never calls this a full payable quote. |
| SEO-01 | Investigated, no new reproduced defect | Representative live documents and existing metadata/sitemap tests were checked. No indexing or publication gate changed. See validation results below. |
| TEST-01 | Implemented for this slice | Synthetic examples remain in unit tests. Browser tests use existing menu records and cover small screens, keyboard access and denied consent. |
| TRUST-01 / SEC-01 | Preserved, targeted verification | There are no new fetches, writes, permissions, identifiers, ingestion paths or publication paths. Runtime schemas reject malformed amounts, currency and source schemes. Existing source and consent tests remain the policy checks. |
| RELEASE-01 | Pending verification and PR | The owner decides the release. No production operation occurred. |

The bounded public interfaces under test are the quote function, menu projection and mounted venue basket.
The independent numeric examples come from master-plan section 6.4, with explicitly labelled synthetic fixtures.
The initial quote test failed because its module did not exist. The first implementation then passed that test.

## Measurement baseline

The live tool confirmed project `219466`. Its governed metric catalog returned zero entries.
This is a one-off acquisition query, not an approved saved KPI.

The query repeats the pack's `WebStatsTableQuery`:

- `breakdownBy`: `InitialChannelType`.
- Current window: `2026-10-22T00:00:00Z` through `2026-10-28T23:59:59Z`.
- Comparison: the tool's preceding equal period.
- `filterTestAccounts`: `true`.
- Event filters: `$host = pubmaxxing.com` and `$virt_is_bot = false`.
- `limit`: `15`.

| Channel | Current visitors | Prior visitors | Current views | Prior views |
| --- | ---: | ---: | ---: | ---: |
| Direct | 5 | 5 | 157 | 59 |
| Organic Search | 5 | 2 | 20 | 17 |
| Referral | 3 | 2 | 100 | 15 |
| Unknown | 2 | 0 | 55 | 0 |

These are consent-limited captured visitors, not the whole audience.
Do not add channel visitor counts into a unique audience.
The small sample proves neither sustained growth nor causation.
The pack records the project timezone as UTC. Tool access did not independently expose the timezone setting.
The query uses explicit UTC boundaries.
Named product-event queries must use `environment = production`, as the canonical metrics document requires.
The browser acquisition query above preserves the pack's production-host filter.

One host and three successful guests produce one creation and one first-two-person crew milestone.
The sum is two activity events describing one outing. It is not two unique outings.
RSVP, link-copy intent, durable membership and completion remain separate.
A true viral coefficient is not the same as redeemed invitations divided by created invitations.
Saved-report changes remain owner-approved dependent work. No new cross-device key was added.

## Product limits and next dependencies

1. Obtain reviewed, branch-specific offer terms through the existing source and moderation controls.
2. Resolve recurring service windows, holidays and local-time ambiguity into exact dated instances before admission.
3. Add voucher purchase/redemption allocation and mixed membership groups with their own acceptance examples.
4. Extend result cards and plan snapshots only when complete terms support an honest quote.
5. Preserve the existing planner budget and price trust until those dependencies are met.

A food-only or alcohol-free basket works without requiring an alcoholic item.
Community Pint Drops remain outside this listed-menu calculator. They keep their separate menu attribution.
The basket does not infer a food portion, dietary suitability, availability, saving or reservation.
Consumer use remains free. Venue membership in an external offer is not a PUBMAXX paywall.

## Validation

Focused validation passed 186 tests across ten files, including source policy, verified analytics, metadata and sitemap checks.
The two data-pipeline suites passed all 87 tests when repeated without a concurrent browser build.
The first broad run reported seven failures and 44,150 passing tests.
Disappearing temporary fixture files affected four pipeline cases while Playwright used the same output directory.
Two UI failures came from changing the selector while that run loaded its files.
The raw font-size fence also rejected the initial CSS. The CSS now uses the existing text token.
The focused UI and token tests pass after these corrections.
Type checking and focused lint pass.
The first ten browser tests passed before the compact selector revision.
Final sequential verification and browser results remain pending.
The initial broad baseline reached data validation, lint and schema comparison.
A concurrent test-first addition made its type check fail on the then-missing quote module.
That run is not a clean untouched-baseline result.
