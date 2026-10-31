# London official menu discovery comparison

Recorded on 31 October 2026. Recommendation: **reject production adoption of PageSift 0.81.0 on this evidence**.
Keep production ingestion unchanged. The benchmark provides a separate experiment and a review packet.

PageSift's native relevance crawler does not establish a complete, verified yield advantage in this experiment.
Quality counts cover a bounded source-reviewed inventory. They include one separate diagnostic venue.
The gold labels remain provisional agent review. A human has not approved the reference inventory.
Complete relevant-page and price-yield figures remain unknown where review is incomplete.
The AGPL integration decision and repeat-run gate also remain open.

## Sample and controls

The input contains exactly 60 websites, with 12 in each geographic stratum.
Each stratum includes four shared-host and eight venue-host websites.
The source snapshots provide 730 eligible London pub records with a website and postcode.
The sample limits each host to three venues and keeps blocked sites in the cohort.
This balanced stress sample does not estimate the prevalence of menu formats across all London pubs.

A uses breadth-first traversal with conventional URL and anchor keywords first at each depth.
B uses the unchanged PageSift 0.81.0 executable with query `pub food drinks menus beer wine prices`.
Both arms start at the same venue URL and receive at most 12 upstream attempts per venue.
Robots, redirects, terms pages, failures, and PDFs all consume that cap. Neither arm retries a failed upstream attempt.
Both arms pay for the root and legal checks. B completes these checks before the native loopback crawl starts.
The native configuration preserves a 30-second first-byte limit. The audit rejects any native fetch error.
The manifest fixes the arm order before crawling. Neither arm receives the other's response cache.

The shared transport applies the repository's source policy, live robots checks, public-address checks, and host rate limits.
It stops at access challenges and rate-limit responses. A linked terms restriction also stops the host.
Four venue workers share one host scheduler, including menu asset hosts.
The minimum host delay is 1.5 seconds, or a longer published delay.
The archive audit checked 637 attempts across all 120 arms and passed.

## Measured comparison

Verified figures below use the supplied annotations. Unreviewed results do not count as verified menus or prices.
Discovery includes eligible menu links on captured pages. Downloads require a successful body fetch by that arm.
The gold review can verify a linked document separately without adding a request to either arm.
The separate reference stage made 22 requests outside both arms.
This earlier reference reader applied at least 1.5 seconds between request starts. No longer published delay occurred in these three reference origins. The final paired crawler uses delays after response completion.
The read times and available source-code hash remain recorded.
These reference reads are separate from the excluded A/B calibration results. Known challenged references were not retried.
Price yield measures verified facts available in downloaded menus under a common offline reader.
It does not measure production ingestion or a fully reviewed price inventory.

| Metric | A: breadth-first | B: PageSift 0.81.0 |
| --- | ---: | ---: |
| Venues | 60 | 60 |
| Upstream request attempts | 324 | 313 |
| Verified menu URLs discovered | 13 | 11 |
| Verified menu URLs downloaded | 11 | 4 |
| Verified PDF URLs discovered | 5 | 5 |
| Verified HTML URLs discovered | 8 | 6 |
| Verified PDF menus downloaded | 5 | 0 |
| Verified HTML menus downloaded | 6 | 4 |
| Venues with a verified PDF URL, lower bound | 1 | 1 |
| Venues with a verified HTML URL, lower bound | 5 | 5 |
| Judged false-positive URLs | 33 | 36 |
| Missing reviewed gold URLs | 11 | 13 |
| Unjudged candidate URLs | 333 | 541 |
| Relevant pages per 100 requests, lower bound | 3.4 | 1.28 |
| Verified price records | 21 | 0 |
| Verified price records per 100 requests, lower bound | 6.48 | 0 |
| Native gateway fetch errors | 0 | 0 |
| Transport failures | 8 | 8 |
| HTTP failures | 12 | 11 |
| Redirect hops | 28 | 25 |
| Rate-limit or unavailable responses | 0 | 0 |
| Blocked venue and URL pairs | 212 | 161 |
| Sum of venue durations, seconds | 1,118.53 | 1,123.85 |
| Median venue duration, seconds | 7.84 | 7.86 |
| 95th percentile venue duration, seconds | 101.36 | 105.07 |
| Node CPU seconds | 6.19 | 37.04 |
| Python parser CPU seconds | 5.96 | 16.14 |
| Native child CPU seconds | 0 | 10.04 |
| Node peak RSS, bytes | 151,005,480 | 150,939,944 |
| Python peak RSS, bytes | 31,866,880 | 28,377,088 |
| PageSift peak RSS, bytes | 0 | 39,157,760 |
| Downloaded bytes | 70,422,858 | 58,529,305 |
| Judged-candidate precision | 28.3% | 23.4% |
| Precision lower bound | 3.4% | 1.9% |
| Precision upper bound | 91.3% | 93.9% |
| Recall against all reviewed inventory URLs | 54.2% | 45.8% |
| Measured-component cost scenario | $0.00660 | $0.00642 |

The cohort took 594.43 seconds of elapsed time.
The sum of venue durations includes overlapping workers and therefore differs from cohort elapsed time.
The native process stops when a new fetch would exceed the upstream cap.
Empty local responses suppress native retries of gateway refusals. The ledger preserves actual upstream statuses and failures.
Its planned SIGINT termination is distinct from a transport failure or a blocked website.

## Gold sample and review limits

The primary sample contains 12 venues selected before the crawl.
The annotation set currently contains 24 verified menu labels, 51 negative labels, and 3 unresolved labels.
Those labels include a separate diagnostic sample outside the primary 12 venues.
Primary-sample discovery recall is 38.9% for A and 27.8% for B.
Primary-sample judged precision is 17.9% for A and 12.5% for B.

| Primary 12-venue sample | A: breadth-first | B: PageSift 0.81.0 |
| --- | ---: | ---: |
| Upstream attempts | 70 | 70 |
| Verified menu URLs discovered | 7 | 5 |
| Judged false positives | 32 | 35 |
| Missing reviewed URLs | 11 | 13 |
| Unjudged candidate URLs | 73 | 306 |
| Verified price records | 0 | 0 |
| Price records per 100, lower bound | 0 | 0 |
| PDF URL recall in the primary inventory | 0% | 0% |
| HTML URL recall in the primary inventory | 87.5% | 62.5% |

The adoption recall, precision, and price-yield gates use this predetermined primary sample.
Both precision figures omit unjudged candidates. They are not complete-cohort precision estimates.
The reference inventory is bounded by recorded reads and reviewed navigation. It does not establish full-site recall.
Blocked primary venues stay unresolved. They do not become zero-menu venues.

The review separates actual menus, menu hubs, navigation, other branches, bus timetables, and cigar catalogues.
Menu hubs count as HTML discovery. A separate downloaded-document count prevents a hub from implying a readable menu document.
Image menu links and external HTML menu services fall outside this crawl protocol.
Reference-only image evidence stays in the review packet and outside HTML and PDF recall.

## Missing URLs and false positives

The live robots endpoint for The Jugged Hare returned HTTP 403 in both arms. Both arms stopped before reading its pub page.
Eight earlier reference URLs therefore count as access misses. These misses do not demonstrate a relevance-ranking failure.
Both profiles also exclude the three Bluecoats image menus. Their missing records state that protocol limit.
The remaining missing-URL differences come from eligible discovery in this observation.

- Arm A: way/160279486, [reviewed menu](https://etmcollection.co.uk/venue/the-jugged-hare/). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm A: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/JH-Sunday-Feast-Menu-0626.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm A: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-Hare-Christmas-Set-Menu-Design-26.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm A: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-October-ALC.pdf.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm A: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-Pre-Theatre-Working-File-Sep-26.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm A: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-Set-Menu-Sep-26.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm A: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-Sunday-Working-File-October-2nd.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm A: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2026/10/Jugged-Hare-Christmas-Day-Menu-Design-26.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm A: node/2267462478, [reviewed menu](https://thebluecoatspub.com/wp-content/uploads/2025/12/1EDF8B55-A8BA-4EAD-A80C-26C72A93F546.jpeg). Cause: image-menu-excluded-by-protocol. The arm did not identify this reviewed menu URL.
- Arm A: node/2267462478, [reviewed menu](https://thebluecoatspub.com/wp-content/uploads/2025/12/765DCE6C-7ED7-40FF-ABB4-0B5DD5E96F59.jpeg). Cause: image-menu-excluded-by-protocol. The arm did not identify this reviewed menu URL.
- Arm A: node/2267462478, [reviewed menu](https://thebluecoatspub.com/wp-content/uploads/2025/12/EB426D09-90C1-4EDA-944D-0B6127886F23.jpeg). Cause: image-menu-excluded-by-protocol. The arm did not identify this reviewed menu URL.
- Arm B: way/160279486, [reviewed menu](https://etmcollection.co.uk/venue/the-jugged-hare/). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm B: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/JH-Sunday-Feast-Menu-0626.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm B: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-Hare-Christmas-Set-Menu-Design-26.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm B: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-October-ALC.pdf.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm B: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-Pre-Theatre-Working-File-Sep-26.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm B: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-Set-Menu-Sep-26.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm B: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2024/07/Jugged-Sunday-Working-File-October-2nd.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm B: way/160279486, [reviewed menu](https://etmcollection.co.uk/app/uploads/2026/10/Jugged-Hare-Christmas-Day-Menu-Design-26.pdf). Cause: access-unavailable-during-paired-run. The arm did not identify this reviewed menu URL.
- Arm B: node/2267462478, [reviewed menu](https://thebluecoatspub.com/wp-content/uploads/2025/12/1EDF8B55-A8BA-4EAD-A80C-26C72A93F546.jpeg). Cause: image-menu-excluded-by-protocol. The arm did not identify this reviewed menu URL.
- Arm B: node/2267462478, [reviewed menu](https://thebluecoatspub.com/wp-content/uploads/2025/12/765DCE6C-7ED7-40FF-ABB4-0B5DD5E96F59.jpeg). Cause: image-menu-excluded-by-protocol. The arm did not identify this reviewed menu URL.
- Arm B: node/2267462478, [reviewed menu](https://thebluecoatspub.com/wp-content/uploads/2025/12/EB426D09-90C1-4EDA-944D-0B6127886F23.jpeg). Cause: image-menu-excluded-by-protocol. The arm did not identify this reviewed menu URL.
- Arm B: way/155488603, [reviewed menu](https://www.greeneking.co.uk/pubs/greater-london/sawyers-arms/christmas/festive-menu). Cause: not-discovered. The arm did not identify this reviewed menu URL.
- Arm B: way/155488603, [reviewed menu](https://www.greeneking.co.uk/pubs/greater-london/sawyers-arms/christmas/buffet-menu). Cause: not-discovered. The arm did not identify this reviewed menu URL.

These reviewed false positives illustrate the errors. The machine-readable file contains every judged false-positive URL.

- Arm A: [https://www.brunningandprice.co.uk/company/pubs-with-private-dining/](https://www.brunningandprice.co.uk/company/pubs-with-private-dining/). This is a company page or article. It is not a menu bound to the input Roebuck in Chiswick.
- Arm A: [https://www.brunningandprice.co.uk/company/food/](https://www.brunningandprice.co.uk/company/food/). This is a company page or article. It is not a menu bound to the input Roebuck in Chiswick.
- Arm A: [https://www.brunningandprice.co.uk/company/drink/](https://www.brunningandprice.co.uk/company/drink/). This is a company page or article. It is not a menu bound to the input Roebuck in Chiswick.
- Arm B: [https://www.brunningandprice.co.uk/company/pubs-with-private-dining/](https://www.brunningandprice.co.uk/company/pubs-with-private-dining/). This is a company page or article. It is not a menu bound to the input Roebuck in Chiswick.
- Arm B: [https://www.brunningandprice.co.uk/company/food/](https://www.brunningandprice.co.uk/company/food/). This is a company page or article. It is not a menu bound to the input Roebuck in Chiswick.
- Arm B: [https://www.brunningandprice.co.uk/company/drink/](https://www.brunningandprice.co.uk/company/drink/). This is a company page or article. It is not a menu bound to the input Roebuck in Chiswick.

The Old Ship is a useful retrieval case.
A downloaded 6 PDFs there. B downloaded 0 PDFs.
The PDF set includes food, wine, and cocktail menus, alongside a cigar catalogue that does not qualify.
An offline sensitivity check also extracted little main content from the original Old Ship HTML.
This supports the extraction-failure explanation for this case, but it does not isolate the gateway's full effect on all websites.
This diagnostic venue is outside the primary gold sample. Its price records are a lower bound, not evidence of population-wide superiority.
Both arms use one common candidate filter. Their false positives do not establish that PageSift alone misclassified those pages.

## Compute and estimated cost

Node CPU and sampled RSS come from each venue worker.
The same Node worker runs both arms sequentially. CPU uses per-arm deltas. RSS can include memory retained from the earlier arm.
B starts and stops one private native API process per venue, including access-refused seeds. Its measurements include that overhead.
A persistent shared PageSift service is outside this profile.
Each Python parser reports its own CPU and peak RSS.
The operating system's time tool measures PageSift CPU and maximum RSS.
These memory figures are separate process maxima, not one simultaneous process-tree peak.
Other machine activity was not controlled. Treat the wall-time comparison as one observation.

The scenario uses USD 0.05 per CPU-hour, USD 0.01 per GiB-hour of memory, and USD 0.09 per downloaded GiB.
These assumed rates are not a supplier quote or an actual bill.
The memory scenario charges each arm's summed duration at the sum of its measured component maxima.
The estimate excludes coordinator CPU, retained storage, review labour, and an unknown commercial licence price.
There are no paid API or model calls in either arm.
Separate reference fetches and offline review extraction stay outside the crawl request and latency totals.
The common offline PDF extraction took 0.224 seconds.
Its measured Node CPU was 0.036 seconds. Its native child CPU reading was 0 seconds.
Native CPU readings below the printed 0.01-second resolution can round to zero. Zero is not proof of no CPU work.
The common offline component cost scenario is less than $0.00001 and is separate from both crawl estimates.
The verification-stage JSON records its memory readings and automated crawl-plus-extraction duration.
Full latency through human gold approval is unknown. The report gives crawl latency and common extraction time. Human-review turnaround remains unknown.

## Licence and adoption decision

The [PageSift 0.81.0 release](https://github.com/YOLOW92/pagesift/releases/tag/v0.81.0) states AGPL-3.0-only and offers commercial licensing.
The [licence review](../../LICENCE_REVIEW.md) records the release commit and the relevant obligations.
This experiment runs the unchanged executable as a local API bound to 127.0.0.1. It does not distribute the executable or integrate it with the app.
Process isolation alone does not settle whether a future combined or hosted integration meets AGPL requirements.

The declared gates require 12 human-reviewed venue inventories, 95 percent precision, and 10 percent gains in recall and verified price yield.
They also require latency and cost ratios at or below 1.5, a repeated run, an access audit, and a licence decision.
The current gate results are in `comparison.json`. At least one gate is false or unknown.
Reject integration now. Keep A as the benchmark baseline and use the review packet to resolve the remaining evidence.

## Reproduce and inspect

The [benchmark instructions](../../README.md) provide the installation, CLI checks, live run, and offline evaluation commands.
The [input manifest](../../manifest.json), [protocol](../../protocol.json), and [rubric](../../RUBRIC.md) define the experiment.
The response archive remains private. Its local path is recorded with the research task.
The committed request, page, and access-event files preserve URLs, crawl paths, read times, and response hashes.
The exact crawler source hashes appear in `run.json`.
The recorded run started at 2026-10-31T20:36:01.743Z and finished at 2026-10-31T20:45:56.189Z.
The recorded base head is `c350c09b785f4e5798665751606ed0466a5ff213`. The harness file hashes identify the run's exact source bytes.

Calibration runs exposed timing and parser problems and are excluded from this comparison.
An earlier terms matcher also missed a published scraping prohibition. Some calibration reads continued after that prohibition.
I stopped those runs, excluded their data, added benchmark-only host holds, and added a regression test for the exact wording.
The corrected run applies those holds before any request. Its audit checks that no request follows a detected terms refusal.
The [calibration notice](../../calibration-notice.json) records the known affected requests and partial-log limits. Those reads are not described as permitted.
Excluded A/B calibration latency and data do not enter this comparison.
Calibration traffic preceded the measured run and may have affected later access responses. Server-side state was not controlled.
No production crawl, ingestion, migration, application build, or deployment ran as part of this benchmark.
