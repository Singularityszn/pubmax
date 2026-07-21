# PUBMAXX IMAGE RIGHTS AUDIT (2026-07-21)

Probe **U9** from `docs/UNKNOWNS_MAP_2026-07-21.md`: full audit of third-party
image usage and rights exposure. Extracts every `img-src` origin from the CSP,
traces where each image enters the system and how it renders, classifies its
rights posture, and ranks a remediation plan.

**Headline finding (bigger than the CSP):** the CSP `img-src` allowlist is *not*
the real exposure surface. Almost every venue photo is fetched **server-side by
`/api/image-proxy` and re-served same-origin with a 1–7 day cache**. That is
**reproduction + caching of third-party copyrighted images**, which is a
stronger copyright/ToS posture than plain hotlinking — and it squarely breaches
the TripAdvisor and Flickr terms of use (both prohibit copying/redistribution to
another server; Flickr caps caching at ~24h). The CSP allowlist only governs
what the *browser* loads directly, which turns out to be a small set (Wikimedia
landmarks, Greene King menu tiles, and user/IdP avatars). See §4.

---

## 1. The CSP `img-src` allowlist (verbatim, from `proxy.ts` line 56)

```
img-src 'self' data: blob:
  https://commons.wikimedia.org
  https://upload.wikimedia.org
  https://*.supabase.co
  https://*.googleusercontent.com
  https://gkbr-p-001.sitecorecontenthub.cloud
  https://www.jdwetherspoon.com
  https://live.staticflickr.com
  https://whatpub-new.s3.eu-west-1.amazonaws.com
  https://media-cdn.tripadvisor.com
  https://images.squarespace-cdn.com
  https://images.cdn.inapub.co.uk
  https://www.greeneking.co.uk
  https://encrypted-tbn0.gstatic.com
  https://static.wixstatic.com
```

The CSP lives in `proxy.ts` (Next.js 16 renamed `middleware`→`proxy`), built
per-request with a nonce. It is the **only** copy — `next.config.mjs` no longer
serves it. 14 remote origins beyond `'self' data: blob:`.

## 2. Two rendering pipelines (this is the crux)

Every venue photo resolves through **one shared vocabulary** (`lib/venueImages.ts`,
`resolveVenueImage`) with two provenance classes:

- **`chain`** (scraped pub-website / brand-CDN photo) → rewritten to
  `/api/image-proxy?src=<url>` (`proxiedVenueImageUrl`). The **browser only ever
  loads `/api/image-proxy` (same-origin `'self'`)**; the third-party host is
  fetched **server-side** by the route handler and streamed back re-hosted, with
  `Cache-Control: public, max-age=86400, s-maxage=604800`.
- **`community`** (Pint Drop upload) → a signed `*.supabase.co` Storage URL,
  rendered directly (our own bucket, consent-gated).

Direct-render surfaces confirmed by code trace:

| Surface | File | Host loaded directly by browser |
|---|---|---|
| Map landmark card | `components/PubMapCanvas.tsx:2070` | `commons.wikimedia.org` → 302 → `upload.wikimedia.org` |
| Landmark chapter page | `app/landmark/[id]/page.tsx:94` | same (Wikimedia) |
| Food-menu tile | `components/drinks/MenuCategoryGrid.tsx:67` | `gkbr-p-001.sitecorecontenthub.cloud` (4 tiles) |
| Sign-in avatar | `components/auth/SignInButton.tsx:222` | IdP avatar → `*.googleusercontent.com` (Google) |
| Profile avatar | `components/profile/ProfileHeader.tsx:66` | `*.supabase.co` or IdP `*.googleusercontent.com` |
| Pint Drop / community photos | feed, recap, bar-tab, `PintDropsList`, `VenueInspectorHeader` | `*.supabase.co` |
| Venue sheet / gallery / hover | `VenueImage.tsx`, `hoverCard.ts:35` | **`/api/image-proxy` only** (never the brand host) |

**Consequence:** the brand/platform CDN origins (`jdwetherspoon`, `greeneking`,
`staticflickr`, `tripadvisor`, `squarespace-cdn`, `inapub`, `wixstatic`,
`whatpub`, `gstatic`) are **never loaded directly** — they are all served through
the proxy. Their `img-src` entries are **dead** (see §6 code change).

## 3. Per-origin table

"Usages" = image occurrences in served `public/data/*` (`image_url` /
`categoryTiles.imageUrl` fields — the fields that actually become photos; link
fields like `menuUrl`/`website` excluded). "Render" = direct (browser hits the
host) vs proxied (server-side via `/api/image-proxy`).

| Origin | Usages (served) | Entry point | Render | Rights class | Exposure |
|---|---|---|---|---|---|
| `commons.wikimedia.org` | 13 landmarks | `lib/landmarks.ts` (hardcoded `Special:FilePath`) | **direct** | LICENSED/OPEN | Attribution obligation **unmet** — see §5 |
| `upload.wikimedia.org` | redirect target + 8 `image_url` | Wikimedia 302 hop; proxied dataset rows | **direct** (landmark) | LICENSED/OPEN | Same attribution gap |
| `*.supabase.co` | user uploads | `pintDropsStore`, `profileStore` | direct | OWN | Low — our bucket, consent-gated |
| `*.googleusercontent.com` | avatars + ~415 Places `image_url` | IdP avatar (direct); Google Places photos (proxied) | mixed | OWN (avatar) / HOTLINKED-PLATFORM (Places) | Places photos: Google Places ToS require SDK + attribution, prohibit caching |
| `gkbr-p-001.sitecorecontenthub.cloud` | 4 tiles direct + 245 `image_url` | `venue_menu_enrichment` tiles (direct); dataset (proxied) | mixed | HOTLINKED-BRAND (Greene King DAM) | Brand IP; plausible operator complaint (U10) |
| `www.jdwetherspoon.com` | 160 `image_url` | dataset `image_url` | proxied | HOTLINKED-BRAND | Brand IP; re-host+cache |
| `www.greeneking.co.uk` | 6 `image_url` | dataset `image_url` | proxied | HOTLINKED-BRAND | Brand IP; re-host+cache |
| `live.staticflickr.com` | 23 `image_url` | dataset `image_url` | proxied | HOTLINKED-PLATFORM | Per-photo license (many ARR); Flickr caps caching ~24h; attribution to photographer required |
| `media-cdn.tripadvisor.com` | 19 `image_url` | dataset `image_url` | proxied | HOTLINKED-PLATFORM | TripAdvisor ToS: copying/redistribution to another server **strictly prohibited** |
| `whatpub-new.s3.eu-west-1.amazonaws.com` | 21 `image_url` | dataset `image_url` | proxied | HOTLINKED-PLATFORM | CAMRA WhatPub assets; re-host+cache |
| `images.squarespace-cdn.com` | 9 `image_url` | dataset `image_url` | proxied | HOTLINKED-PLATFORM | Site-owner asset (venue's own site) |
| `images.cdn.inapub.co.uk` | 8 `image_url` | dataset `image_url` | proxied | HOTLINKED-PLATFORM | Inapub trade-press assets |
| `encrypted-tbn0.gstatic.com` | 5 `image_url` | dataset `image_url` | proxied | HOTLINKED-PLATFORM | Google image-search **thumbnail cache** — double exposure (Google's cached copy of a third party's image) |
| `static.wixstatic.com` | 4 `image_url` | dataset `image_url` | proxied | HOTLINKED-PLATFORM | Site-owner asset (venue's own Wix site) |

Rights-class tally: **LICENSED/OPEN 2 · OWN 1 (+avatars) · HOTLINKED-BRAND 3 ·
HOTLINKED-PLATFORM 7 · MIXED 1** (`googleusercontent`).

> Note: `data/*` (non-`public`) CSVs mirror these hosts in the tens of thousands
> (e.g. `greeneking.co.uk` 31k, `jdwetherspoon.com` 15k) but those are builder
> source files and mostly `website`/`menuUrl`/`bookingUrl` **link** fields, not
> image URLs, and are not served to the browser. The proxy's own allowlist
> (`lib/venueImageHosts.server.ts`) deliberately parses only the `image_url`
> field of `pint_prices_app_dataset.json` for exactly this reason.

## 4. The proxy is the real exposure surface

`app/api/image-proxy/route.ts` + `lib/venueImageHosts.server.ts` let the server
fetch any host that appears in the `image_url` field of
`pint_prices_app_dataset.json` (~439 distinct pub-website hosts) plus every https
URL in `venue_menu_enrichment.json` and `pubmaxxing_seed_snapshot.json`. Each hit
is **re-served from our origin** and **CDN-cached up to 7 days**. Assessment:

- **Copyright:** re-hosting + caching a copy is *reproduction*, a stronger
  infringement posture than hotlinking (which at least serves from the source).
  Applies to all HOTLINKED-BRAND and HOTLINKED-PLATFORM origins.
- **ToS:** TripAdvisor ("copying, transmission, reproduction, replication…
  strictly prohibited") and Flickr (caching capped at ~24h; ours is 7 days) are
  breached by the proxy specifically. Google Places photo ToS (SDK + attribution,
  no caching) likewise.
- **Breakage risk (the U9 concern):** the proxy sends
  `user-agent: pubmaxxing-image-proxy`, no `Referer`, no cookies. Referer-based
  hotlink checks won't fire (no Referer sent), but a CDN that blocks unknown UAs
  or requires a signed URL (TripAdvisor `media-cdn`, some Wix/Squarespace tiers)
  will 502 → silent gradient fallback. This is already partially masked because
  `VenueImage` falls back to the community photo on error.
- **Attribution:** no proxied image shows author/license. Flickr CC + Wikimedia
  files that flow through the proxy carry unmet attribution obligations.

## 5. Attribution obligations currently unmet

- **Wikimedia (landmarks):** `lib/landmarks.ts` sets `credit: "Wikimedia Commons"`
  and the card renders `Photo · Wikimedia Commons`. Most Commons files are
  CC-BY / CC-BY-SA and require **author name + license name + link**, not just
  the platform name. Crediting the platform is **not** compliant attribution.
- **Flickr (proxied):** CC-licensed Flickr photos need the photographer's name +
  a link back to the photo page. None shown.
- **Google Places (proxied `googleusercontent`):** Places photos require the
  attribution string Google returns with each photo. None shown.

The app already has the vocabulary for this — `VENUE_IMAGE_PROVENANCE_LABEL`
renders a provenance chip on every `VenueImage`. It shows *source class* ("Photo:
pub website" / "Photo: community") but never per-image author/license.

## 6. Code change applied (pure win, zero-risk)

Removed the **9 dead origins** from `proxy.ts` `img-src` — the brand/platform CDNs
that are **only ever reached through the same-origin proxy** and never loaded
directly by the browser (confirmed: zero direct `<img>`/`<Image>` references in
`app/`+`components/`; all venue photos route through `VenueImage`/`hoverCard`,
which proxy):

`jdwetherspoon.com`, `greeneking.co.uk`, `live.staticflickr.com`,
`media-cdn.tripadvisor.com`, `images.squarespace-cdn.com`,
`images.cdn.inapub.co.uk`, `static.wixstatic.com`,
`whatpub-new.s3.eu-west-1.amazonaws.com`, `encrypted-tbn0.gstatic.com`.

**Kept** (genuinely load directly): `commons.wikimedia.org`,
`upload.wikimedia.org` (landmarks), `gkbr-p-001.sitecorecontenthub.cloud` (menu
tiles), `*.supabase.co` (community + avatars), `*.googleusercontent.com` (IdP
avatars).

Why this is safe **and** rights-protective: proxied images load under `'self'`
regardless, so nothing breaks; and removing these entries means a future dev who
tries to hotlink an unlicensed TripAdvisor/Flickr/Wix image **directly** now
fails visibly in dev instead of silently shipping infringing imagery. The CSP
becomes a "proxy-or-nothing" guard. (This does **not** reduce the underlying
re-hosting exposure — that is the proxy's job, §7.)

## 7. Ranked remediation plan

1. **Decide the venue-photo licensing model (biggest exposure).** The proxy
   re-hosts+caches hundreds of brand/platform images. Target end-state: proxy
   fetches **only licensed/open sources** — own photography, Wikimedia,
   community Pint Drops, and the **Wave 3.5 operator rail** (venue-submitted
   photos with an explicit license grant, which is the intended licensing fix per
   U9). Narrow `lib/venueImageHosts.server.ts` to that allowlist.
2. **Fix Wikimedia attribution now (cheap, legally required).** Add per-file
   author + license (+ link) to `lib/landmarks.ts` `image` objects and render
   them in the landmark card / chapter page. Same pattern for any Flickr-CC or
   Google-Places photo retained via the proxy — surface the attribution the
   provenance chip already has a slot for.
3. **Drop the pure-platform-cache origins outright.** `encrypted-tbn0.gstatic.com`
   (Google's thumbnail cache — worst posture, thumbnails of others' images) and
   `media-cdn.tripadvisor.com` (explicit ToS breach) should be removed from the
   dataset `image_url` field and the proxy allowlist entirely; the community/own
   fallback already covers the gap.
4. **Proxy the 4 Greene King menu tiles or drop them.** Route
   `MenuCategoryGrid` tile images through `/api/image-proxy` (consistency) or
   remove them; then `sitecorecontenthub.cloud` can also leave the CSP.
5. **Shorten proxy cache + add takedown posture.** Drop `s-maxage` from 7 days to
   ≤24h (aligns with Flickr's cap) and document a takedown/complaint route
   (ties into U10's two-sided ops playbook — "one angry Wetherspoon email").
6. **Instrument proxy 502s.** A referer/UA-blocking CDN degrades silently today;
   log proxy failure rate per host so breakage (the U9 "breaks silently" risk) is
   visible before users hit gradient fallbacks.

## 8. Top three actions for the owner

1. **Treat venue photos as a licensing decision, not a scraping detail.** The
   `/api/image-proxy` re-hosts + 7-day-caches hundreds of TripAdvisor / Flickr /
   Wix / Wetherspoon / Greene King images — reproduction that breaches
   TripAdvisor's and Flickr's terms. Commit to licensed/open sources only (own
   photos + Wikimedia + community Pint Drops + the Wave 3.5 operator rail) and
   scope the proxy allowlist to them.
2. **Fix Wikimedia attribution this week.** Landmark photos credit only
   "Wikimedia Commons"; CC-BY-SA requires author + license + link. It is cheap,
   it is a real legal obligation, and the UI already has a provenance slot for it.
3. **Ship the "proxy-or-nothing" CSP (done here) and delete the worst origins.**
   The 9 dead brand/platform origins are removed from the CSP in this PR; next,
   purge `gstatic` thumbnails and `media-cdn.tripadvisor.com` from the data +
   proxy allowlist so the highest-risk sources can't be served at all.

---

*Method: CSP extracted from `proxy.ts`; render paths traced across
`app/`+`components/`; usage counts from `public/data` `image_url`/`imageUrl`
fields via JSON parse; ToS positions grounded in TripAdvisor Terms of Use and the
Flickr API Terms of Use (July 2026). Not legal advice — the copyright/ToS calls
should be confirmed by counsel before launch.*
