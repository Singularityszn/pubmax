# Accepted account / all-alcohol journey source review

Status: source/artifact review only. No new tests, browser, build, publisher fetch, or product edits. Actual Root receipt accepted-account-browser-results.json: 23 cases,16 PASS,7 FAIL. Four category quote failures, one Vodka transfer-CTA failure, two independent account welcome geometry failures. Current-source explanation below is not native internal attribution.

## Vodka: result owner changes sibling position

MobilePlanActivation.tsx166–179 stores full generation response and transfer CTA data in local result state. Line200 schedules onGenerated. PubMap.tsx4692–4695 activates generated Plan; useMapPlanCoordinator.ts27–32 changes mode to build and built IDs. lib/pubMap.ts1001 phonePlannerOrder then changes describe-first to build-first. PubMap.tsx5370–5377 and5437 move the unkeyed MobilePlanActivation child from first to last fragment slot. React cannot retain its previous local result by unkeyed slot identity. MapRouteTransferButton.tsx11 owns exact absent link label.

Minimal mounted regression: real MobilePlanActivation successful fetch/parse, actual parent onGenerated switches same phone planner order, then assert result, exact transfer link and transferred route survive. Preserve build-first UX. A stable child key within the same fragment is a narrow candidate. Root owns PubMap; no patch here. Actual Vodka browser RED proved link absence after valid quote assertions; no native mount journal was captured by this child.

## Four quotes: coverage selection differs from amount comparison

all-alcohol-journey.spec.ts114–135 already proves real category GET contains committed named anchor ID. Lines154–160 perform a fresh unanchored mobile request; the declared journey.anchor is never accepted into its generation request. MobilePlanActivation.tsx143–148 sends city/query/partial context only: no anchor, no intake, no selected serving.

planGeneration.server.ts312–330 derives selected serving only from independently approved accepted anchor hint. Lines374–375 correctly omit non-beer amount scoring without selected comparable serving. Lines377–413 keep eligible pub candidates within actual Night Area and rank score/distance. planGenerationSelection.server.ts132–145 uses legacy first-N selection without intake/hard constraints. planGenerationDto.ts211–213 sorts fallback alternatives by distance and caps at two. A farther eligible offer may therefore be omitted from both primaries and backups without any projection corruption.

Lightweight static join of current committed bundle to pub-only London slim rows within Shoreditch centre51.524,-0.079/radius1.6km finds exactly one raw listed venue per failed category: whisky/gin/rum/shot Sun Tavern venue-ndc1rt,1.4702km. Vodka sole raw listed venue is Owl & Pussycat venue-t3ii33,0.2463km. All five quotes have no servingSize. These are raw-retained inventory counts, not a rerun of full server eligibility; the recorded browser index assertions separately establish index eligibility for this run. Actual response bodies/selected candidate IDs were not archived in the JSON report, so specific route selection remains source inference, not reconstructed native payload evidence.

Minimal test-first seam: existing generation POST/DTO tests with one approved eligible category offer farther than two closer unpriced candidates, unknown serving, no accepted hint. Assert offer coverage is retained honestly, while unknown amounts never drive a Cheapest rank and category/expiry/constraint exclusions remain. If primary-route category availability is the promised behavior, test it separately from nearest-backup coverage; do not change arbitrary distance/cap controls to force a pass. Preserve explicit accepted anchor/group tests, forged/expired/override/zero-proof guards. Future native repetition should archive actual POST body and full generated primary/backup IDs/evidence before attributing selection.

## Supply trust limitation

The sole Sun gin row label is literally “sics Umbrella Vesper Grey Goose Vodka, Boatyard Gin, Kina L’Aero, Vichy Catalan” (data/uk_prices/site_harvest.jsonl912), a mixed recipe label. Whisky/rum/shot rows913–915 carry neither drink label nor serving. No new primary publisher inspection here. Software eligibility does not independently verify these as genuine single-spirit or measured offers. Do not fabricate measures or recategorize; permitted publisher evidence is needed. Ordinary unknown-serving rows need not be invalid, but these acceptance fixtures cannot prove exact-serving cheapest-any-alcohol success.

No overlap with Luna mapRouteTransfer tests. Root runtime and maintained source ownership unchanged.
