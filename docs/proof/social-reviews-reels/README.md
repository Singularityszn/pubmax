# Social: pub reviews, photo-first cards and reels (ADR 0017)

Captured on a local `next dev` with browser auth in the keyless e2e shape and
the Social API answered by route doubles (`/api/social/access`, posts,
interactions, reviews, media and one video). The photos are the repo's own
landing imagery (`public/landing/london/ATTRIBUTION.md`); the reel is a
six-second clip cut from one of them. Viewports are 390x844 and 1440x900,
captured at 2x and scaled to half.

| File | What it shows |
| --- | --- |
| `light-phone-card.webp` | A review post: who and where, the photo at 4:5, Cheers / Comment / save / report, the score and the words. |
| `light-phone-full.webp` | Below desktop the feed comes straight after the lanes; Your pubs, ranked follows the posts. |
| `dark-desk-full.webp` | Desktop: the feed held to 560px beside the rail with Your pubs, ranked. |
| `reel-card-light.webp` | A reel in the feed, playing muted, with its length and the full-screen door. |
| `reels-viewer-light.webp` | Reels full screen above the tab bar: close, sound, handle, pub, score and caption. |
| `composer-dark.webp` | The composer once a pub is picked: Add photo or Add video, and the half-star score. |

Measured in the same run: the feed video reached `readyState` 4 and played
while in view; the viewer opened with focus on Close, played the clip in view,
and Escape closed it.

Added with the friends' ranking and multi-photo posts:

| File | What it shows |
| --- | --- |
| `carousel-light.webp` | A three-photo post swiped to photo 2: the counter, the dots and the arrows a mouse gets. |
| `lot-ranking-dark.webp` | Your lot's pubs: each friend's newest score averaged, with who scored it. |

Measured in that run: the carousel held 3 slides, read "1 / 3", and moved to
"2 / 3" on a swipe (phone) and on Next (desktop); the ranking switch loaded 3
rows under "Your lot's pubs".

Added with "which did you prefer?":

| File | What it shows |
| --- | --- |
| `compare-panel-light.webp` | Yours in compared order: place, band and the 0-10 each derives, with Rank a pub. |
| `compare-question-light.webp` | The question sheet on a phone: the new pub against the middle of the band, and Too close to call. |
| `compare-done-dark.webp` | The result on desktop: #3 and 8.4, Loved it, and the list behind it already moved. |

Measured in that run: with four pubs in Loved it, placing The Black Friar
between The Lamb and The Crown & Anchor took two questions and landed #3 of
five; the dialog closed and the panel re-read the order.

Added with the pub page (`/pubs/[id]`), on the real record for the Greyhound,
Kensington (`venue-10jffb0`), with `/api/social/pub-reviews` and
`/api/social/rankings` answered by route doubles. The chain photo reads "No
photo yet" only because the capture sandbox cannot reach the chain's image
host through `/api/image-proxy`.

| File | What it shows |
| --- | --- |
| `pub-page-phone-light.webp` | The whole page on a phone: Book a table as the one filled action, pints and prices, hours, what's here, the story, photos and visits. |
| `pub-page-desk-dark.webp` | Desktop, dark: the same page with "Your lot on Greyhound", 4.3 from three friends, and their posts. |
| `pub-rank-done-light.webp` | Rank it from the pub page: placed #2 at 8.4 in Loved it, and the action now reads "Ranked #2". |

Measured in that run: the lot section rendered three reviews only after the
session answered signed in; Rank it opened on this pub's band question,
placed it in two answers, and the page's action changed to "Ranked #2". An
unknown id answers 404.
