# Astra F01, F02, F08, F09: the measurement

Astra's fresh production delta audit (6 September 2026, baseline `1d676d930`)
read the live site through HTML, the API and PostHog. Four of its findings are
one rule read four ways: a surface may say only what it can keep.

Everything here was measured against a local production build of this branch
(`NEXT_DIST_DIR=.next-prod`, keyless), before and after, at 320x568, 390x844,
768x1024 and 1440x900, light, reduced motion, `Europe/London`.

## F09: what a shared `/plan` link says

`before/plan-head.txt` is the route's head as production served it. It declared
no metadata of its own beyond a title, so it inherited the ROOT layout's Open
Graph block whole:

    <meta name="robots" content="index, follow, max-image-preview:large"/>
    <meta property="og:title" content="PUBMAXX: listed pint prices on an interactive map"/>
    <meta property="og:url" content="https://pubmaxxing.com"/>
    (no canonical)

`after/plan-head.txt` is the same read on this branch:

    <meta name="robots" content="noindex, follow"/>
    <link rel="canonical" href="https://pubmaxxing.com/plan"/>
    <meta property="og:title" content="Sort the outing · PUBMAXXING"/>
    <meta property="og:url" content="https://pubmaxxing.com/plan"/>
    <meta property="og:image" content="https://pubmaxxing.com/og.png?v=20260715-coral"/>

The image line is the one that nearly went missing: a route that declares its
own `openGraph` inherits NO images from the layout, so a first cut of this fix
would have unfurled a bare card.

`/plan/[id]` was verified separately and needed no content change. Its card was
already the privacy-safe preview: the area, the stop count and the start time,
never the user's title, never the crew, never a venue. It is noindex now for a
different reason, that an invite is one crew's night rather than a search
result.

## F01, F02, F08: the Today cards

`today-390x844.png`, before and after, carries all three in one screen.

**F01, the location prompt.** Before: "Share your rough location once and we'll
show the last train from your nearest station. It stays on this page and is
never saved." The rounded point in fact goes to `/api/last-train` and
`/api/tfl-disruption`, and our server passes it to Transport for London, which
/privacy already described in full. After: three sentences that say what
happens, in order, and a way out that needs no location at all.

**F02, the picks door.** Before: "Quiet pints near you", opening `/near`, which
ranks the nearest pubs by listed price and holds no crowd signal at all. After:
"Pubs near you".

**F08, the daily editorial card.** Before: "Pub of the day / Sun Inn / pub in
Barnes, London, UK / Sourced / View source". After: a pub whose sourced sentence
names it and says something checkable about it, with one internal action into
the product. The gate admits 22 of the 342 joined historic rows today; an empty
set is the honest "still in the archive" card rather than a lowered bar.
