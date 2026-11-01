# Backlink playbook

This playbook turns the 69 ranked backlink tactics into work for PUBMAXX. Some
tactics need a page on the site. The tree ships those pages. Most tactics are
outreach: a person writes to an editor or a journalist. The captain does that
work, and the ledger records it.

Read with `docs/PRD_SEARCH_GROWTH_2026-07-16.md` (wave S4, the data PR plan).
That record is dated, so this file is the live one.

## What the tree ships

| Surface | Tactics | What it does |
| --- | --- | --- |
| `/press` (`app/press/page.tsx`) | 13 to 19, 24 to 26, 50 to 55, 60 | Findings as whole sentences, the sample, the method, stable links, a credit line, embed code for the edition's summary card and the contact for journalists. |
| `lib/citableFindings.ts` | 15, 17 | Writes each finding from a Pint Index snapshot. It writes nothing below the admission floor. |
| `/pub-crawl-cost` (`app/pub-crawl-cost/`) | 38 to 43 | A free calculator on a permanent page. See its [calculation guide](https://pubmaxxing.com/pub-crawl-cost#how). |
| `lib/crawlCostCalculator.ts` | 39, 41 | The sums, in whole pence. `__tests__/crawlCostCalculator.test.ts` tests normal and unusual inputs. |
| `/pint-index/YYYY-MM` | 18 | Dated editions do not change after they go up. `/press` cites the newest edition that clears the floor. |
| `docs/growth/backlinks/ledger.csv` | 5, 27, 34, 45 | One row for each pitch, request, placed link and recovered link. |
| `docs/growth/backlinks/listing.json` | 65 to 69 | The one record every directory listing copies. |
| `next.config.mjs` `redirects()` | 36, 37 | An old URL with live links gets a permanent redirect to its replacement. |
| `public/llms.txt` | 8 | Tells answer engines which pages they can cite. |

`__tests__/citableFindings.test.ts` and `__tests__/backlinkLedger.test.ts` are
the fences. The ledger fence checks the columns, the closed kinds and statuses,
the dates, and that one journalist request is pitched once. The listing fence
checks that the listing addresses are the same as `lib/siteContact.mjs`.

## The rules

1. **No figure we cannot show.** A pitch, a quote or a graphic uses only a
   figure from `/press` or from a dated Pint Index edition. If `/press` shows no
   findings, we pitch no statistic. The anti-goals in the root `AGENTS.md`
   apply: no invented prices, hours or pub lore.
2. **Link to the answer.** Each placement links to the page that answers the
   sentence around it (tactics 3 and 4). A price claim links to the dated
   edition. A crawl cost claim links to `/pub-crawl-cost`. A history claim
   links to the `/historic/{slug}` page.
3. **Link to the frozen page.** When you quote a figure, link to
   `/pint-index/YYYY-MM`, not to the live `/pint-index`.
4. **Log it first.** Add the ledger row when you send the pitch, not when the
   link goes live. Then a second person cannot pitch the same request.
5. **No paid links and no link schemes.** An editorial exchange is a link that
   helps the reader on both sites. It is never a payment and never a network
   of sites that link to each other only for search.
6. **Nothing is fetched without permission.** A script that reads another site
   goes through `lib/harvest/sourcePolicy.ts` (see `scripts/AGENTS.md`). Brand
   mention and dead link searches use a search console or a search engine by
   hand. The tree has no crawler for them.

## The tactics, by tier

The tactic numbers match the ranked list. "Captain" means a person does it.

### S tier

| Tactics | Who | How |
| --- | --- | --- |
| 1 to 5, exchange editorial links | Captain | Find London pub, beer and city guide sites. Offer a link that helps their reader, for example a borough pint price or the calculator. Log each one. |
| 6 to 12, get into roundups | Captain | Search for "best pub crawl apps", "London pub map" and similar lists, and the lists answer engines cite. Send the author one exact line to add, with the feature it shows. Check the entry each quarter and send corrections. |
| 13 to 19, publish statistics | Tree and captain | `/press` publishes the findings, the sample and the method. Each month that clears the floor gives new findings. Link each finding to its edition. |
| 20 to 27, answer journalist requests | Captain | Use Qwoted and similar request services. Answer only on topic and before the deadline. Lead with one sentence from `/press`, add the figure and the link. Log each request. |

### A tier

| Tactics | Who | How |
| --- | --- | --- |
| 28 to 32, learn from competitors | Captain | Read the pages that link to other pub apps. Read the sentence around each link. Where our page answers the question better, send the author that answer. |
| 33 to 37, recover links | Captain and tree | Search for "PUBMAXX" and "pubmaxxing" mentions with no link, and for our charts with no credit. Ask for the link. If a removed page still has live links, add a permanent redirect to its replacement in `next.config.mjs`. |
| 38 to 43, free tools | Tree and captain | `/pub-crawl-cost` is the first tool. Offer it to pub crawl guides, stag and hen guides and student union pages. A second tool needs a repeated question first, and tests on normal and unusual inputs. |

### B tier

| Tactics | Who | How |
| --- | --- | --- |
| 44 to 49, replace broken resources | Captain | Find dead pub guide and pub app links on other sites. Read the archived page. If we have a page that does the same job, send the broken link and our page. |
| 50 to 55, make the missing visual | Captain and tree | Ask the author first. Use only the author's checked facts or our own Index figures. Send the image and the embed code from `/press`, which carries the credit. |
| 56 to 60, make the missing video | Captain | Offer a short map or calculator demo for one section of a guide. Record it only after the author agrees. Send it with the credit line from `/press`. |

### C and D tiers

| Tactics | Who | How |
| --- | --- | --- |
| 61 to 64, vendor case studies | Captain | List the tools we use (for example Vercel, Supabase, MapLibre, PostHog). Write how we use one and what it changed. Send it to that vendor's customer story editor. |
| 65 to 69, business listings | Captain | Claim the listings PUBMAXX is eligible for. Copy every field from `listing.json`. If a field changes, change `listing.json` first, then each listing. |

## The ledger

`docs/growth/backlinks/ledger.csv` has one row for each piece of outreach.

| Column | Meaning |
| --- | --- |
| `id` | A short unique name, lower case with hyphens. |
| `tactic` | The tactic number, 1 to 69. |
| `logged_on` | The day you sent the pitch or found the link, as `YYYY-MM-DD`. |
| `kind` | One of `placement`, `roundup`, `journalist`, `recovery`, `replacement`, `asset`, `listing`. |
| `source_url` | The outside https page that links, or will link, to us. For a journalist request, the request page. |
| `destination_path` | The path on our site that the link points to, for example `/pint-index/2026-09`. |
| `context` | The sentence around the link, or the request topic. |
| `status` | One of `pitched`, `accepted`, `live`, `declined`, `lost`. |
| `checked_on` | The last day somebody opened the page and saw the link. A `live` row needs one. |
| `notes` | Anything else. Put commas inside double quotes. |

Check every `live` row each quarter. If the link has gone, set `lost` and ask
again or recover it. The PRD metric "backlink count on the Pint Index page per
quarter" is the number of `live` rows with a `/pint-index` destination.
