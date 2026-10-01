# R20 selected venue native timing

Report/source-only analysis. Only this receipt written. No execution, browser, network, test, build, install, app/test/index edit or publication.

Inputs: `/tmp/pubmaxx-r20-selected-attribution/report.json`, coordinator-confirmed session1054 terminal EXIT0; parsed `completed=true`, `errors=[]`, five valid interactions. Comparison: terminal `/tmp/pubmaxx-r19-selected-attribution/report.json`. Both attribution drivers add observers/evaluations and are diagnostics, not replacements for strict CWV gate. Separate runs are not a controlled interleaved experiment.

## Timing outcome

R20 LCP10472/9148/9044/8408/8752 ms, INP88/104/80/56/48 ms. Median9044/80 versus R19 median8732/56. Observed median is312ms slower LCP and24ms slower INP. Ordering improvement did not demonstrate a speed gain. This does not alone establish a production regression or host-noise cause.

All times below ms since navigation. Inspector group is actual corresponding6 JS plus17 CSS carriers, identified by shared unchanged resource ownership and exclusive compiled markup, not every resource near API time.

| Run | PubMap ready | API start / response end | Inspector start / last end | Inspector host observed | LCP |
| --- | --- | --- | --- | --- | --- |
| 0 |7052.9|7100.4 /8341.4|7070.2 /9477.5|9664.7|10472|
| 1 |5362.3|5399.1 /6669.1|5371.3 /7846.6|8265.8|9148|
| 2 |5998.4|6035.1 /7305.6|6006.5 /8489.9|8600.2|9044|
| 3 |5349.6|5386.4 /6656.3|5358.5 /7826.8|7956.0|8408|
| 4 |5348.7|5385.1 /6633.2|5357.1 /7834.5|8251.3|8752|

R20 Inspector group starts8-17ms after PubMap-ready and24-30ms before detail API initiation. R19 group started4-9ms after API response completed. Real concurrency is established by resource ordering independently of held-response test. Despite earlier group initiation, group completion versus corresponding R19 sample changes by -107/-74/+382/-134/-79ms. Earlier request start does not produce an equal completion or paint gain.

Coordinator separately reports terminal ordering GREEN: real held responses, one Inspector acquisition/one API, named estimate, tab focus, native close and painted points, no errors. That proves ordering and usable selected flow. It does not prove faster LCP.

## Bytes and actual ownership

R20 corresponding Inspector group encoded129346 bytes (126.3KiB), versus R19 129363, a17-byte decrease. Same17 CSS carriers and five unchanged JS carriers; exclusive Inspector markup owner changed from `2ea1vza_70h_n.js`50302 bytes to `07ao84009amoy.js`50285 bytes. This matches actual `venueAddress` and `venueTabShort` compiled markup, not filename coincidence.

MapLibre owner remains `21ctu9vnullj5.js`, encoded286192 bytes. Critical scene carrier remains `30ey3ucokxihb.js`, encoded26237 bytes, with same native source character34403 scene callback. PubMap carrier encoded45353 versus45339 bytes. Changed chunk filenames elsewhere are not evidence of equivalent byte growth; compiler redistribution matters. R20 also acquires a843-byte dynamic-loader forwarding carrier `0ibudikvuyxt8.js` after API completion, whose served compiled body forwards dynamic imports rather than carrying selected venue data. It is excluded from the corresponding23-resource Inspector cohort and disclosed separately.

## API queue and frame evidence

API encoded body remains2967 bytes. R20 start-to-requestStart queue1018.6/1047.9/1046.6/1040.9/1033.5ms, versus R19 321.0/337.6/346.5/347.0/346.6ms. Later four R20 server intervals requestStart-to-responseStart stay2.2-2.6ms, versus R19 2.0-2.6ms. R20 body transfer212-227ms later four. There is no native evidence of a multi-second server lookup.

R20 inserts all23 Inspector acquisitions immediately before API initiation; their network work overlaps API and MapLibre. Increased HTTP/1.1 queue is consistent with resource contention from this scheduling, but report lacks an isolated priority/connection experiment proving that sole cause. Do not label API server slower or claim entire700ms queue increase is a render cost.

Every final LCP remains actual `p.venueAddress` text `Camden, Greater London`, not an image or canvas. Before/after action state contains real Princess Louise and estimated £6.50 text; real action targets `button#venueTab-overview`, afterward focused and selected. Probe `selectedStates.heading=null` remains h1/h2 selector mismatch, not missing identity; `host=true` timestamps are DOM observations, not paint timestamps.

Critical scene frame script durations R20 first400.8ms, later292.4/197.5/199.2/215.0ms, versus R19 350.9 and201.2/135.6/235.2/199.8ms. Run1 additionally has a7773.3ms frame426.9ms long containing React MessagePort work296.3ms and MapLibre frame113.7ms; at8295.7ms another419.3ms frame includes MapLibre frame323.7ms. Scene callback begins8715.1ms, completes around9007.5ms; actual scene-built9020.7ms precedes final LCP9148ms. Inspector host was already observed8265.8ms. These are concrete main-thread frame costs near final paint, not proof each script alone causes final LCP.

R20 LCP also precedes actual `pins-visible` in all five (11380.9/9877.9/10259.6/9625.4/9874.6ms). Selected sheet does not wait for visible map pins as a direct source gate. Native scene work nevertheless overlaps presentation. Do not equate source independence with freedom from shared CPU/GPU/network contention.

## Smallest justified next step

No new source optimization justified by this one diagnostic pair. Preserve distinction: ordering contract now works; speed benefit unproved. Root should finish permanent ordering case and existing correctness gates, then obtain same-profile controlled baseline/concurrent comparison in an authorized runtime slot before making performance claims. Focus falsifier on API request queue, exact Inspector cohort completion, native final address paint and scene frame overlap. If slowdown repeats under controlled comparison, reconsider the bounded warm scheduling rather than stacking a new loader, arbitrary delay or budget change. No threshold/profile/budget change proposed.
