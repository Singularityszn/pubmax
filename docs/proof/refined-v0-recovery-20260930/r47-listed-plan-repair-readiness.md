# Listed Plan repair readiness

Status: SOURCE REVIEW ONLY. Production and scratch production files untouched. Await actual owner RED receipt before preparing repair. Recorded 2026-10-01T04:17:00.529497+00:00.

Active source: `/Users/karanmanoharan/.codex/worktrees/overnight-pubpal-completion/pubmaxx`, committed HEAD `040134c5b4b697f775ba4ac8846f43873fbc317c` with provisional minimal50 and acceptance tests in working tree. This is not the independent `overnight-price-map-port-review` checkout or bare 6ee source.

| Prospective owned file | Working-tree SHA256 |
| --- | --- |
| `lib/planSelectedDrinkPriceEvidence.ts` | `123bce83225f97628f4b47335f789c8a97889bb25589e5544a0f6876f86b94b8` |
| `lib/planSelectedDrinkPriceEvidence.server.ts` | `032cb473b640c7e07f2d64dfffa5a4fb23ad2c68d69999ddc318abe17440d1bb` |
| `lib/planGeneration.server.ts` | `53825b2674c1aec531c43b8f0bfca110ba7c1e1b1d7b0167950df49ab28949b4` |

## Smallest correction seams after RED

1. `planSelectedDrinkPriceEvidence.ts:68-82`: existing selected-price delivery helper currently only handles community. Its existing union/cleaner already carries listed source URL, observed timestamp and serving. Add listed delivery through that cleaner, preserving existing community timestamp branch, category equality, zero-proof and beer gates. Normal DTO (`planGenerationDto.ts:107,172`) and anchor-only response (`planGeneration.server.ts:174`) already call it; no DTO rewrite required.
2. `planSelectedDrinkPriceEvidence.server.ts:26-47`: current single community try block rejects all listed hints. Separate requested listed verification against `ukPriceBundleRowsFor(exact canonical stop ID)` and actual `listedCategoryPrices(rows, now)`. Require a ready reader and exact category, amount in pence, source URL, observation timestamp and recorded serving. Rebuild server-owned evidence only from matching eligible quote. Expiry, quarantine, current same-drink/serve replacement and estimates remain owned by existing projection. Community index failure must not erase separately readable listed authority; existing community verification remains unchanged for community hints. Keep both 125ml and 250ml candidates at one venue, rather than taking the first category match.
3. `planGeneration.server.ts:305-354`: candidate preparation only reads community. Enrich scoped canonical candidates with eligible listed category metadata through existing reader/projection. Preserve query reconciliation, temporal constraints, ordering/grounding, proofs, route lifecycle and operation identity. Do not feed arbitrary listed figures into the community scoring map. If listed metadata exists during failed/partial community reads, coverage wording must name the community read rather than claiming no category prices are shown.

## Ranking and selection boundary

`planDrinkRequest.ts:118-131` returns one category only. Its SERVING regex names a grammatical verb, not a quantity parser. `NightContext` and Plan request context have no serving-selector field. `planGenerationRanking.ts:20-27` scores `10 / priceGbp` and names that amount a corroborated community price. Joining mixed listed 125ml/250ml into that input would compare unlike measures and falsely label a publisher quote community.

Bounded propagation proposal therefore attaches listed evidence after scoring/filtering, not as an unqualified amount-ranking input. Preserve existing trusted community selection when present; use independently eligible listed metadata as fallback otherwise. If publisher-first generator precedence is required at that same boundary, it must be explicitly composed with reason/source selection rather than replacing the selected metadata while retaining an unrelated community-price reason. Exact submitted listed hints can be verified independently regardless of another source's availability.

This propagation is not completion of cheapest-any-alcohol acceptance. Category serving-group selection/preservation and honest unknown-serving placement still need the already planned native API/List falsifier and separate repair. No default volume, brand restriction, new hint API or partial-market claim is proposed. Existing selected evidence API has no drink-label field; tests do not invent it.

## Proof and timing

Acceptance packet: `r47-listed-plan-acceptance-tests.patch`, SHA256 `5ce12e55a1c34805e0a6abe45a1b41c3501ead171921c55a669f9a28b870bb39`. Scratch source application only; runtime/type/lint results remain owner-controlled and UNRUN here.

Realistic source-only repair ETA: 15-20 minutes after meaningful actual RED receipt and authorization, limited to three files above and owned scratch patch. No producer/generated/raw changes. Current community-only minimal50 guard stays in place until exact authority-bound repair is proved. Historical R46 proof cannot substitute for current release verification.
