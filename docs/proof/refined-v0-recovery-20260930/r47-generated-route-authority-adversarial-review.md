# Generated route price authority - adversarial source review

Packet: 5573952d0439a5dffbb711b513d6e4236bf3d00210b88973bc472a2292df6bab. Source review only. No runtime, typecheck, tests or native acceptance executed by this lane. Original packet unchanged.

No concrete reachable blocker found in reviewed paths. Duplicate IDs, missing/extra resolved stops and partial snapshots suppress all generated totals and quotes via RoutePanel's exact unique stop-set check. Reverse keeps same snapshot and stop set; switching to unrelated suggested IDs cannot reuse its money or quotes. Actual manual mutations clear quotes/budget while keeping requested category; explicit replacement/clear restores manual Pint behavior. Nonbeer and zero-proof totals remain null irrespective of budget contents. Beer budget accepts only nonnegative safe-integer per-person pence. Zero-proof activation retains no alcoholic quote.

SaveCrawlStoryStop already accepts number|null; both its share payload and POST normalize missing/null priceGbp to null. Packet uses that existing null contract for generated nonbeer/zero-proof, without substituting pint amounts. Default manual Pint markup and money path remain unchanged. Selected quote text uses existing closed cleaner/description, JSX escaping and URL validation.

One bounded helper caveat: useMapPlanCoordinator.ts:37 invalidates snapshot even when setBuiltIds updater returns unchanged current IDs. PubMap.tsx:4174 contains such a no-op branch for a rejected nonpub addition. All traced live UI entry points guard that action: VenueOverviewTab.tsx:1159, VenueStickyBar.tsx:58 and phone peek require pub; VenuePicker receives pub-filtered inventory. Therefore no actual user-visible no-op loss established. Do not label this a reproduced product blocker or expand patch. If a future permitted nonpub attempt reaches this callback, minimal pre-call rejected-add guard in toggleBuiltStop would preserve existing snapshot; rendered regression should first establish that reachability.

Separate open limitations remain: generated authority is not serialized in existing crawl/share/reload links; captured MobilePlanActivation result may transfer original order after generic route reverse/edit. This packet neither rewrites signed proof nor claims those cases solved. Source review does not prove browser guard, build compatibility, current native flow or final gates.

Current Root before-pin differences at review: none across all seven packet paths.
