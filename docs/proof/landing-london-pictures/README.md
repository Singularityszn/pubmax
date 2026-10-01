# The landing pages show London

> Dated proof for the 6 September 2026 change. The 1 October change replaced
> the root hero picture and loading priorities. Measurements below describe
> the earlier build. Current behaviour lives in the
> [front-door rule](../../rules/components-design-system-and-launch-primitives.md#the-front-door-shows-london-then-answers-in-one-tap).

Captain 6 September 2026: "I want the landing pages to show the pictures of
London." What is on this page is the measurement behind that change: what a
reader sees at four widths before and after, what the picture costs the
landing's own performance ceiling, and the licence reading that decided which
photographs could be used at all.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `/` | The answer card on a flat panel | The same card on a photograph of the pub it names, or of its borough, or of London |
| `/borough/[slug]` | Head, then the price card | A framed picture of the borough under the head |
| `/area/[slug]/drink/[brand]` | Head, then the rows | A framed picture of the area under the head |
| `/borough` (the index) | No picture | No picture: a directory of 33 boroughs is not a place |
| `/places` | No picture | No picture: it lists every city we know, so a photograph per card would fetch a screenful of them, past the 150 KB a landing may add, for cities that are not London |

Screenshots are `before-*` and `after-*` at 320x568, 390x844, 768x1024 and
1440x900, on a production build with `deviceScaleFactor: 2`.

## The licence reading

The pint dataset already carries an `image_url` on 1,928 of its 3,760 rows.
Every lane of that supply is refused for the landing, and for three different
reasons.

| Host | Rows | Verdict |
| --- | --- | --- |
| `images.app.goo.gl`, `search.app.goo.gl` | 891 | Already blocked in `lib/venueImages.ts`. They are Google share redirects, not images. |
| `lh3`/`lh5.googleusercontent.com`, `encrypted-tbn0.gstatic.com` | 418 | Google Places photographs. The Maps Platform terms require the attribution Places returns with the photo and forbid caching or re-hosting it, so re-encoding one into this repository under our own credit is precisely what they refuse. |
| `gkbr-p-001.sitecorecontenthub.cloud`, `www.jdwetherspoon.com`, `www.greeneking.co.uk` | 411 | The operator's own marketing image. Permission to CRAWL a chain's pages is not a licence to re-host and re-encode its photographs, and a landing is a page we publish rather than a pub's own page. They stay where they already are, hotlinked through `/api/image-proxy` on the venue sheet. |

What is used instead: nine openly licensed photographs from Wikimedia Commons
(CC BY, CC BY-SA and CC0), re-encoded and committed under
`public/landing/london/`, each credited on the page it appears on with its
photographer, its licence and a link to both. `public/landing/london/ATTRIBUTION.md`
is the record beside the bytes.

Nothing here is generated. `public/landing/hero-night.jpg`, a stock photograph
of an unnamed pub interior that nothing had referenced since the landing was
rebuilt around the answer card, is deleted in the same change: a landing that
shows a picture of a pub now shows a picture of THAT pub.

## The contrast promise

Text over a photograph is held to WCAG AA by arithmetic rather than by sampling
the nine pictures we happen to hold. `landingPhotoScrimContrast`
(`lib/landingImagery.ts`) composites the card scrim over the WORST pixel a
photograph could ever carry, a pure white one, and the test spends it.

| Ink | Over a white photograph | Over a black photograph |
| --- | --- | --- |
| `--landing-photo-ink` `#FBF9F6` | 7.81:1 | 19.12:1 |
| `--landing-photo-ink-soft` `#E4DFD8` | 6.19:1 | 15.16:1 |

Both clear 4.5:1 for every picture that could ever join the set. The price stamp
is untouched: a figure wears its BAND (`lib/priceBand.ts`) and the band paints
its own surface, so it reads over any photograph by its own rule.

A photo card is dark in both themes on purpose. The promise is made against the
photograph rather than against the page, and a theme-following scrim would be
two promises with only one of them provable.

## What the picture costs

Measured with the project's own harness (`e2e/helpers/perfMeasurement.ts`, the
method block of `perf/route-budgets.json`: 390x844, 4x CPU throttle, Chrome Fast
4G, third parties blocked, 1 warm-up run and 3 measured, median), on production
builds of `origin/main` at `5bf044f55` and of this branch, served one after the
other on the same machine.

| `/` | Before | After | Ceiling | Inside |
| --- | --- | --- | --- | --- |
| LCP | 616 ms | 692 ms | 800 ms | yes |
| Requests | 41 | 43 | 46 | yes |
| JS decoded | 900 KB | 910 KB | 1010 KB | yes |
| Server render | 5 ms | 13 ms | 150 ms | yes |
| CLS | 0 | 0 | n/a | yes |

No ceiling in `perf/route-budgets.json` moved, and none needed to. The picture
costs 76 ms of largest contentful paint and two requests.

Added weight on the phone profile is ONE file: the landing's anchor photograph
at 640 wide in AVIF, 17.9 KB. The whole set's narrow AVIFs run 15.1 KB to
26.7 KB, so the widest a landing could ever be asked to add is 26.7 KB against
the 150 KB budget. The 1280 files exist for a DPR-2 screen and are 41.3 KB to
83.0 KB.

CLS stayed at 0 because every `<img>` carries its intrinsic `width` and
`height`, and the inline base64 placeholder (about 200 bytes per photograph)
paints with the HTML so the card never opens as a hole.

## How a photograph joins the set

`node scripts/landing/build-landing-photos.mjs`, by hand. It is not wired into a
build: a picture of a place is a curation decision, and a job that re-fetched
one could swap the photograph under a caption that names its author. The script
refuses any licence outside CC BY, CC BY-SA, CC0 and public domain, and writes
both the files and the attribution record.
