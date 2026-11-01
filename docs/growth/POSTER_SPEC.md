# QR poster and beer-mat spec (pub partnerships)

Cycle 17, Lane D. Print-ready spec for the two physical assets a landlord puts on
the bar: an A5 poster and a beer mat. The owner runs pub partnerships; this is the
brief a designer or a print shop builds from. No em dashes anywhere on the
artwork or in this spec.

Positioning line, used on both pieces: **London runs on its pubs. This is the app
that runs your night.**

Voice: the pub as a third place, presence over optimization. Never a "drink more"
line. The poster sells the app, not another round.

---

## Shared brand kit

Pulled from the app so print matches screen. Colours are from `lib/ogBrand.tsx`
and `app/globals.css`.

- Coral (brand, action): `#ff5a5f`. Coral bright accent: `#ff7a55`.
- Ink deep (near-black ground): `#060607`. Ink (near-white): `#eef3ef`.
- Amber (price and route energy, use sparingly): `#f0a01a`.
- Display type: Space Grotesk Bold for headlines, Medium for body. Vendored at
  `public/fonts/SpaceGrotesk-Bold.ttf` and `SpaceGrotesk-Medium.ttf`.
- Mark: The Crossing mark in a coral rounded-square chip, exactly as the OG
  wordmark lockup renders it (`Wordmark` in `lib/ogBrand.tsx`). Two crossing arms
  in ink on the coral chip, one lit coral-bright node at the centre.

Print production, both pieces:

- Colour: CMYK for the printer, built from the hex values above. Ask the printer
  to match coral to a warm red, not a pink.
- Resolution: 300 dpi minimum on any raster; prefer vector for the mark, type,
  and QR.
- Bleed: 3mm on every edge. Keep all text and the QR inside a 5mm safe margin.
- Finish: matte stock. A pub is a wet, low-light room; matte reads better than
  gloss under downlights.

---

## QR code spec (both pieces)

- Target URL: `https://pubmaxxing.com/?src=poster` (optional `utm_*` tags). The
  site redirects that arrival to `/near` with the same query kept, so a scan
  opens nearby prices rather than the marketing landing. Keep the same tag
  across a partner's print run.
- Error correction: level H (30 percent). Bar-room posters get scuffed and part
  covered; H survives it.
- Quiet zone: at least 4 modules of clear space on all sides. Do not let artwork
  or a border touch the code.
- Colour: dark modules in ink deep `#060607` on a light field, or ink on the
  coral chip only if contrast tests clean. Never coral modules on ink; scanners
  need high luminance contrast. Test-scan the final proof under low light before
  the run.
- Minimum printed size: 30mm on the beer mat, 40mm on the A5 poster.
- Caption under the code, same on both: "Point your camera here."

---

## A5 poster

- Trim size: 148mm wide by 210mm tall (portrait). With 3mm bleed the artboard is
  154mm by 216mm.
- Layout, top to bottom:
  1. The Crossing mark chip plus the PUBMAXXING wordmark, top left.
  2. Headline, large, Space Grotesk Bold.
  3. One short subhead line.
  4. Three-item benefit list, Medium weight.
  5. QR block: the code, its caption, and the short URL, bottom right or centred.
  6. Footer strip: the positioning line, small, full width.

Copy (exact):

- Headline: `Sorted your pint yet?`
- Subhead: `See what a pint costs near you, and what is on tonight.`
- Benefit list:
  - `Real pint prices, sourced and dated.`
  - `Quiz, sport, music, and deals on tonight.`
  - `Plan the night, share one link, mates tap I am in.`
- QR caption: `Point your camera here.`
- Short URL under the code: `pubmaxxing.com`
- Footer: `London runs on its pubs. This is the app that runs your night.`

Optional partner line, if the landlord wants their name on it (keep it factual,
never a fake quote): `Proudly on the bar at THE PUB NAME.` Replace THE PUB NAME
with the venue. Leave it off if not requested.

---

## Beer-mat variant

- Shape and size: 95mm square is the standard British beer mat; 90mm round also
  works. With 3mm bleed the square artboard is 101mm by 101mm. Board is pulp
  beer-mat stock, roughly 1.4mm, printed both sides.
- The mat has less room than the poster, so it carries one idea, not five.

Front copy (exact):

- Line 1, small eyebrow: `Whose round is it?`
- Line 2, headline, Bold: `Know the price before you buy it.`
- The Crossing mark chip, small, in a corner.

Back copy (exact):

- QR code, centred, with caption below: `Point your camera here.`
- Under the caption: `pubmaxxing.com`
- Foot of the mat, small: `London runs on its pubs. This is the app that runs
  your night.`

Beer-mat notes:

- Keep the QR to the back only, so a wet pint glass never sits on the code.
- One coral chip is enough; do not flood the mat with brand colour, it needs a
  light field for the QR to scan.
- No prices are printed on the mat itself. Prices live in the app where they are
  sourced and dated; a printed price would be stale the day it is printed.

---

## Launch variant, November 2026

For the Product Hunt launch on Tuesday 17 November 2026 and the pubs claimed
before it (`docs/growth/LAUNCH_KIT_2026-11-17.md`, section 6). It carries the
launch story, the hunt for the UK's cheapest drink, without breaking any rule
above: the same brand kit, the same QR spec, the same positioning line, and no
price printed on paper. The hunt's figure lives on the site, beside its pub,
its source and the day the source was read. On paper it would be stale, and it
would be a price with none of those things.

Campaign tag, the same across one pub's whole order (the site keeps `src` and
`utm_*` and drops the rest):

- Poster: `https://pubmaxxing.com/?src=poster&utm_campaign=launch-2026-11&utm_medium=poster&utm_source=PUB-SLUG`
- Beer mat: `https://pubmaxxing.com/?src=poster&utm_campaign=launch-2026-11&utm_medium=beermat&utm_source=PUB-SLUG`

Replace PUB-SLUG with a short name for the pub, in lower case with hyphens.

### A5 poster, launch copy (exact)

Same layout as the A5 poster above.

- Headline: `How cheap can a pint get?`
- Subhead: `We hunt for the cheapest pint in Britain, and show who listed it and when.`
- Benefit list:
  - `Real pint prices, sourced and dated.`
  - `The cheapest listed pint near you, first.`
  - `Plan the night, share one link, mates tap I am in.`
- QR caption: `Point your camera here.`
- Short URL under the code: `pubmaxxing.com`
- Footer: `London runs on its pubs. This is the app that runs your night.`

The optional partner line is unchanged: `Proudly on the bar at THE PUB NAME.`

### Beer mat, launch copy (exact)

Front:

- Line 1, small eyebrow: `The hunt is on.`
- Line 2, headline, Bold: `Find the cheapest pint near you.`
- The Crossing mark chip, small, in a corner.

Back: unchanged. The QR code with `Point your camera here.`, then
`pubmaxxing.com`, then the positioning line at the foot.

### Why these lines are allowed

- "The cheapest pint near you" is what the scan opens: `/near`, which compares
  listed pint prices near the reader, cheapest first
  (`lib/posterLanding.ts`). It names no pub and no figure.
- "How cheap can a pint get?" is a question, not a claim.
- Neither piece asks anyone to drink more. Both sell the app, not another
  round.

---

## Handoff checklist

- Test-scan every proof under low light before approving the run.
- Confirm the campaign tag on the QR matches the partner and is consistent across
  their whole order.
- Check no em dash slipped into artwork copy during layout.
- Confirm the positioning line is present and spelled exactly as above.
- Confirm no private individual appears on any artwork.
