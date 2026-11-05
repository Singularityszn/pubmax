# Search and growth evidence, 5 November 2026

Production returned commit `445df3a6bc85f2403f984a5f4a32e3e62d9731ff` from `/api/version`. The sprint branch is separate.

## Weekly PostHog snapshot

Project [219466](https://eu.posthog.com/project/219466/web). The catalog returned no governed metrics. These queries use consented browser data. The sample cannot establish a ranking change or a cause.

| Measure | 22–28 October UTC | 29 October–4 November UTC |
| --- | ---: | ---: |
| Organic Search visitors | 5 | 9 |
| Organic Search pageviews | 20 | 74 |
| Narrow organic landing cohort | 2 | 2 |
| Cohort devices that opened a venue sheet within one day | 0 | 1 |
| Cohort devices that then created a plan within one day | 0 | 0 |

To repeat acquisition, use Web Analytics → Channels, with `InitialChannelType`, production `$host = pubmaxxing.com`, bot exclusion and the project test-account filter. Run each complete UTC week. Read the Organic Search row for visitors and views.

To repeat the funnel, use an ordered one-day funnel with the project test-account filter. Filter all events to `environment = production` and `$virt_is_bot = false`. Use these steps:

1. Use `$pageview` with `$host = pubmaxxing.com` and session `$channel_type = Organic Search`. Limit `$pathname` to `/`, `/area/[slug]`, `/crawls` and `/routes/[slug]`.
2. Use `venue_sheet_opened`.
3. Use `plan_created`.

The funnel counts consenting devices. It uses a smaller route and event scope than acquisition. It does not join devices, guests or plans. The project taxonomy did not list invitation, RSVP, booking or crew events in this read. No invitation or booking count can be established from it. If the events become available, report copies, share actions, guest opens, RSVPs and server-verified crew milestones separately. Apply the [invitation definitions](../../analytics/METRICS.md#32-invitation-response-measures) to separate copies from share actions. A share action does not confirm delivery. An RSVP measures a response. An outbound click measures a click. Report plan creation, crew commitment and completion separately.

For a return check, query `activity_pulse` in the same two UTC weeks. Filter `environment = production`, exclude recognised bots, and group `anon_` IDs by presence in each week. The result was **11 prior devices, 9 current devices and 5 present in both**. This diagnostic uses environment filtering and does not inherit the project test-account filter. It is not organic cohort retention or evidence of a return after an invite.

The latest Initial Referring Domain table showed Google, Ecosia, Instagram, Google Accounts, direct and unknown. There was no named AI domain in that table. Referrer loss can hide AI visits. AI citations and crawler visits need separate evidence. Neither was measured.

## Public search and Tonight

| Path | Initial response | Canonical | Sitemap | Public action |
| --- | --- | --- | --- | --- |
| `/` | 200, price hunt and Today/Tonight | `https://pubmaxxing.com` | Yes | Open the pub on the map |
| `/area/victoria` | 200, prices, publishers and stations | Self | Yes | Open Victoria on the map |
| `/crawls` | 200, featured and named routes | Self | Yes | Open a route or its ordered map stops |
| `/routes/victorian-soho` | 200, five ordered stops and straight-line estimates | Self | Yes | Open the ordered stops in map planning mode |

Repeat with `curl -fsS https://pubmaxxing.com/<path>`. Check the title, robots tag, canonical, heading and destination links in the initial HTML. Check `/robots.txt` and `/sitemap.xml` separately. All four pages allowed indexing and returned public content. `/index` served a second indexable copy with a canonical to the homepage. The branch adds a permanent redirect.

The public web search sample returned all four target URLs and the `/index` alias. This sample does not establish Google indexing or rank. No authorised Search Console property data was available. See the [existing access instructions](../../growth/SEARCH_CONSOLE.md).

The live homepage showed “right now” above a price with a 2 October source read. Its London comparison counted 938 pubs, with 63 missing a read day. The branch keeps the price records and makes the scope and date explicit.

The reported empty Tonight state was intermittent in the live audit. At about 10:38 UTC the homepage reported five listings. The public `/api/whats-on?window=tonight` read returned 95 recurring chain deal rows, 47 unmatched Ticketmaster event rows and 10 Question One quiz rows. Five quiz rows had venue matches. `/api/out?city=london&day=today` returned 47 event and 22 music rows, all without a venue match. Counts describe the feed at that time. They do not verify that an event took place or that a branch honoured an offer.

The branch keeps the event and recurring deal claims separate. It also uses the source date for hand-entered Wetherspoon terms and the refresh clock for the next occurrence. The existing basket and quote tests passed. The chain terms leave exact branch prices and participation open, so they do not supply a payable basket quote.

## Public competitor sample

Observed on 5 November 2026. The pages show the features below. The sample makes no claim about coverage, rank or features outside those pages.

| Product | Public evidence | Difference from the PUBMAXX path |
| --- | --- | --- |
| PubWatch UK | Maps and compares pints, wine and pub meal staples across the UK. [About](https://pubwatchuk.co.uk/about) | Direct comparison across comparable dish categories. PUBMAXX has a selected venue menu basket. |
| The Pub Exchange | A round calculator checks a selected set of drinks and excludes pubs with incomplete prices. [Calculator](https://thepubexchange.com/pint-calculator) | Compares the same drinks across pubs. The PUBMAXX basket works within one venue. |
| Barometer | The finder combines tap, price, sport, music and outdoor seating filters. [Product](https://www.barometer.org.uk/) | Combines many venue attributes in one filter. PUBMAXX keeps source checks and dated event claims separate. |
| DesignMyNight | Lists and links to book London events and experiences. [London listings](https://www.designmynight.com/london/whats-on) | Booking discovery has wider categories. PUBMAXX measures the outbound click and keeps the group plan in the app. |
| FANZO | Matches sports broadcasts to venues and fan zones. [About](https://www.fanzo.com/en/about) | The fixture-to-screening lookup is the primary journey. PUBMAXX requires venue evidence for a screening claim. |
| London on Tap | Publishes free themed self-guided routes and a linked pub directory. [Routes](https://londonontap.com/) | Starts with the theme and the route. PUBMAXX named routes also provide price receipts and an editable map arrival. |

Original X reads for the brand and founder, including replies, were unavailable in the public fetch. Search did not surface an accessible relevant original post. Direct Grok analysis was unavailable. No competitor content entered product data.

## Remaining gaps in priority order

1. Refresh approved price evidence with dated branch reads. The October data still limits present-day price confidence.
2. Obtain complete offer terms from approved publishers. Branch participation, item eligibility and mandatory charges gate a comparable payable total.
3. Increase verified London pub event coverage. Keep broad ticketing matches, regular schedules and confirmed pub events separate.
4. Obtain authorised Search Console and invitation evidence. Keep the anonymous device funnel separate from cross-device delivery and completed bookings.
