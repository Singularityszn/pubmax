# Menu and price evaluation rubric

The primary gold sample contains the 12 venues selected in `manifest.json` before crawling.
Gold means a reference inventory that a reviewer can inspect independently of either crawler's score.
Agent review remains provisional until a human approves it. The output must state the reviewer type.

## Review each venue

1. Confirm the venue's identity from its official site.
2. Compare the postcode or full street address with the input record.
3. Follow the site's menu navigation and record each reviewed menu document.
4. Inspect the menu contents and the venue attribution.
5. Record a verdict, evidence, format, source path, and read date.
6. Record the scope that the review covered and any access limit.

A chain page must identify this branch. A matching pub name alone is insufficient.
A PDF on an asset host can qualify when the verified official site directly links it as this venue's menu.
A chain-wide menu needs explicit evidence that it applies to this branch.
An off-site booking page, menu aggregator, search result, or unbound branch menu does not qualify.

Reviewers inspect the union of both arms' pages and the official navigation's additional menu links.
The review packet keeps uncrawled links separate from fetched documents.
An uncrawled link is a review lead. It is not a verified gold URL.
Review fetches use a separate recorded budget and the same access rules.
Review requests never enter either benchmark denominator or latency.

## Menu verdicts

| Verdict | Required evidence |
| --- | --- |
| `menu` | Readable food or drink offerings, or an official menu hub with direct menu choices, bound to this venue |
| `not-menu` | A readable page that does not meet the menu rule, such as booking, news, navigation, another branch, or an offer without a menu |
| `unresolved` | Missing identity, blocked access, an unreadable document, an image without readable text, or an ambiguous branch association |

A menu hub counts as an HTML menu URL. The report also gives document-only coverage when that distinction matters.
Food, drinks, Sunday, children's, breakfast, and seasonal menus can qualify.
A dated seasonal menu retains its date and conditions. It does not become evidence of today's regular prices.
Duplicate URLs with fragments count once. Redirect aliases count as one final URL.
Different final URLs count as separate URLs. Identical document hashes also receive a duplicate-document flag.
Record HTML and PDF formats from the response body, not just the URL suffix.

Use `relevant: true` only for a verified menu or a useful official menu hub.
Keep `unresolved` labels out of precision and recall denominators.
Never convert a missing annotation to `not-menu`.
For a fetched page, require the annotation to match its response body hash.
A label for a different captured body does not establish a verdict, relevance, or prices for that page.

## Price records

A verified price record needs an item name, a stated GBP amount, an exact supporting excerpt, and a verified menu URL.
Keep serving size, quantity, category, and conditions when the source states them.
An unknown serving size stays null. A glass or bottle never becomes a pint.
A service charge, deposit, subscription, delivery fee, or discount percentage is not an item price.
An image-only menu needs a separate visual or OCR review. A text reader's empty output is not zero prices.

Every record has a stable ID, `item`, `amountGbp`, `currency`, `serving`, `conditions`, and `evidence`.
The label states `priceReviewComplete` when the reviewer inspected the whole menu for prices.
A partial set is a lower bound. A complete yield must stay unknown when any relevant menu has an incomplete price review.
Deduplicate the same item, amount, serving, and conditions within a venue's reviewed menu set.
Keep genuine food and drink records separate in the report when both occur.

## Metrics

| Metric | Definition |
| --- | --- |
| Verified official menu URLs discovered | Distinct fetched candidates or eligible menu links with an independently reviewed `menu` label and official identity evidence |
| Verified menus fetched | Reviewed menu URLs whose bodies the arm downloaded successfully |
| PDF and HTML coverage | Discovered URLs and fetched URLs by reviewed response format, plus recall against each gold format |
| Relevant pages per 100 requests | 100 times reviewed relevant fetched pages divided by all upstream attempts |
| Verified price records per 100 requests | 100 times deduplicated reviewed price records divided by all upstream attempts |
| Precision | Verified menu candidates divided by all judged candidates |
| Recall | Verified discovered gold menu URLs divided by all verified gold menu URLs in the reviewed inventory |
| Missing URLs | Verified gold URLs that an arm did not identify, including fetched pages its detector missed |
| False positives | Candidate URLs with a `not-menu` label |
| Fetch failures | Request attempts with a transport or body-read failure |
| HTTP failures | Responses with status 400 or greater, reported separately from transport failures |
| Redirects | Upstream responses with status 300 through 399 |
| Blocked pages | Pre-request access refusals, challenges, rate limits, and cooldown events, grouped by reason |

Report judged-candidate precision with the number of unjudged candidates beside it.
Complete price yield also requires conclusive review of every successful fetched page, including noncandidates.
Give a complete metric only when its full annotation scope is complete. Otherwise give a lower bound and an unknown complete value.
The primary sample's recall is bounded by the manually established inventory. It is not full-site recall.
Discovery can include a linked PDF whose body only the separate reference review downloads.
Price yield requires that the benchmark arm downloaded the reviewed menu body.
Image menus and external HTML services are recorded as protocol exclusions when a reference review finds them.
Blocked gold venues remain in the review packet as unresolved. They are not zero-menu venues.
The balanced 60-site sample is a stress sample. It is not a random estimate of all London pub websites.

## Adopt or reject

Reject production adoption if access limits or request caps fail.
Reject production adoption while the gold review or licence decision remains incomplete.
After at least 12 human-reviewed venue inventories, apply the gates in `protocol.json`.
PageSift needs at least a 10 percent relative gain in menu recall and verified price yield, with at least 95 percent precision.
Its latency and estimated cost ratios must each stay at or below 1.5.
Repeat the experiment before treating a single network run as a stable performance result.
An improved candidate count alone does not justify adoption.
