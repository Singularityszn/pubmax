# Generated non-beer Map RoutePanel loses drink authority

Status: source diagnosis plus preserved native baseline context. No runtime, tests or production changes in this agent. Current release source may evolve; pins below bind this review.

## Actual preserved evidence

Root `/Users/karanmanoharan/.codex/worktrees/overnight-pubpal-completion/pubmaxx/.audit/overnight-20261001/vodka-handoff-baseline.json` records original Vodka browser failure at e2e/all-alcohol-journey.spec.ts:189 missing Open Plan CTA, one failed Chromium case. Its earlier assertions require generate HTTP200, requested vodka context, null per-person/crew budget, source-stated evidence on at least one primary and exact committed/API quote matching. They completed before missing CTA. Error context `/Users/karanmanoharan/.codex/worktrees/overnight-pubpal-completion/pubmaxx/test-results/all-alcohol-journey-Vodka--3d166-e-retain-published-evidence-chromium/error-context.md` shows Vodka map control; generated Queens Head/Owl and Pussycat/Queen of Hoxton; default Pint radio checked; £12.70 estimated round and 3 pint stops. Original action sequence e2e lines151–160 navigates bare Map drink=vodka, fills outing, clicks Make a plan. It never chooses Pint. Therefore captured bill is not evidence of a deliberate post-generation Pint selection. Browser response full body is not separately reconstructed here.

## Exact source boundary

- components/plan/MobilePlanActivation.tsx:164–201 constructs generated context/budget, owns full mapRoute for exact Plan transfer, calls onGenerated inside startTransition.
- components/PubMap.tsx:4695–4706 takes only generated stop IDs and context.nightArea into coordinator. Category/zeroProof, selected quotes and generated null budget do not reach generic RoutePanel.
- components/map/pubmap/useMapPlanCoordinator.ts:24–29 stores mode/build IDs/mapped/area only. Presentation resolves IDs back into canonical Venue rows. No useGeneratedMobilePlan owner exists in current source.
- components/PubMap.tsx:1679 initializes separate altStyle from seed; :5408–5439 passes RoutePanel route/altStyle and existing venueSignals, no generated drink authority or budget.
- lib/crawlUrl.ts:15–22 explicitly defines altStyle as copy-only, default pint. Checked default Pint is not a selection event or requested drink evidence.
- components/map/RoutePanel.tsx:119 uses crawlSummary(route); lib/venues.ts:1384–1398 sums each known canonical cheapestPrice, ignoring missing rows. In this capture £6.20 + £6.50 = £12.70 although Owl has no pint price.
- components/map/route/RouteMetrics.tsx:44–49 prints GBP/estimated round unconditionally. :80–83 labels stops with default pint noun.
- components/map/route/RouteList.tsx:87–88 chooses community pint signal or venue.cheapestPrice and names cheapestPint. RoutePanel:259–266 also supplies canonical pint figures to SaveCrawlStory.

Stable-key CTA repair cannot change this independent projection. Keeping MobilePlanActivation alive will preserve correct local null-budget disclosure beside still-incorrect generic Pint estimate unless its owner is corrected.

## Smallest meaningful test-first seam

Extend original native Vodka/all-alcohol case after actual generate200/quote/null-budget checks and before CTA navigation: scope visible generic `.routePanel`; assert no Pint-derived GBP estimated round or pint stop names for generated non-beer result without any manual style action. Preserve original quote and exact transfer assertions. For deterministic rendered test, current coordinator public activateGeneratedPlan + RoutePanel composition needs generated context in owning props, not an invented hidden state or user-touch flag. Test should render same canonical pubs carrying tempting pint prices, activate actual generated vodka result with null budget, then assert generic bill remains unavailable while valid selected quote stays separately attributable. Add ordinary manual-pint control and accepted explicit switch control only once owner defines actual switching behavior. No test or proposed production code written now.

## Bounded repair outline, not implemented

Preserve generated drink context/budget at existing coordinator ownership and pass narrow price/display authority into RoutePanel/List/Metrics instead of re-deriving non-beer money from Venue cheapestPrice. Non-beer or zeroProof cannot inherit pint total or bare pint row figures; unknown serving remains unranked and null budget. Manual pint routes retain existing behavior. Explicit manual changes need clear owner semantics so source default radio cannot silently revoke generated drink context. No extra storage, URL token, fake measure, new price pipeline or state wrapper justified. Current live PubMap/CTA owners must compose any repair; this note does not authorize overlapping edits.

## Limitations

This identifies incorrect presentation of already-generated vodka route, not a wrong server budget or trusted quote. It does not prove raw Sun Tavern labels genuine single-spirit offers, cheapest market coverage, or durable full Plan closure. New after-fix native proof remains required.

## Current source SHA256

- `components/PubMap.tsx`: `9f6764d4df05e6a949662d0c2d2323958c5cdbc61b551c2520c719dd4bb61e12`
- `components/map/pubmap/useMapPlanCoordinator.ts`: `be9d689d2ad26e25168077758e6ad2c558125f8ebadabf93838b8714e926d9b9`
- `components/map/RoutePanel.tsx`: `8c9bb569480a105d0d6b6587a357156631038a90efe45bd7fec2d994688bc385`
- `components/map/route/RouteMetrics.tsx`: `4492792d7263f719c39d48c370db6ce5f5dddd92c5262fa4c0162d41679be4ac`
- `components/map/route/RouteList.tsx`: `94320ed1f48a5be012703af01b6e147e5a938fea6ff7a006b43e55aaa7831914`
- `components/map/route/RouteHeader.tsx`: `a1aca49bf27333e579a4c6cddd406ee63b76216e2174b21c90d55b0506554f45`
- `components/plan/MobilePlanActivation.tsx`: `72807f915384ce3f714f8f34b1ec5569f0a90d1740dd75507e1820431c4d272b`
- `lib/venues.ts`: `62bb0363baf06dd8e60f7cf624d1d76f512e1e4c7067b1bbbcf84b4bb6a1c19a`
- `lib/crawlUrl.ts`: `278ab019bd43b601f82ac113b3f6c6c80a5a1a1a9b4f46893dc4776324c5b881`
- `e2e/all-alcohol-journey.spec.ts`: `80be07f002ef10f5e90b76102529c525a253b8e282b40de6dafab8242617b897`

Native report SHA256 `0aa4a23870d720a69681b55ea72da893dfefc3a11696b36349d5d830716fc77b`. Error-context SHA256 `457bd5c5e791c8a8c86cff235393814630d6f6c9c2c54cb82827a9e710968be3`.
