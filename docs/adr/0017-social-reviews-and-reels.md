# ADR 0017: Pub reviews, photo-first posts and reels in Social

## Status

Accepted

## Context

The captain asked for Social to work like the photo and video apps people
already use: people review pubs, post photos, and post longer reels, with Beli
(a ranked list of the places you have been) and OpenTable (venue pages built
from photos and reviews) as the references.

Social already had most of the graph and safety work this needs: verified-adult
access, a chronological feed in three lanes, one moderated photo per post,
consent-gated photo tags, and a full interactions API (cheers, saves, comments,
reports) that the post card never showed. What it did not have was a score, a
video, or a card that looked like a photo app.

Three rules this tree already holds bear on the design, and they stay:

- **The feed is chronological.** No count, score or engagement moves a post
  (`PLG_STRATEGY.md` anti-goals, the Social beta contract).
- **A post never becomes venue or price authority.** A venue's rating and its
  prices come from their own lanes (`docs/adr/0010-community-price-trust.md`).
- **A post that names a pub is friends-only.** `social_posts_public_venue_check`
  keeps a person's whereabouts out of public posts.

## Decision

### 1. A review is one person's score on their own post

A post that names a pub may carry its author's score, 1 to 5 in half stars
(`social_post_reviews`, migration `0182`). The score reads the post's own
`venue_id`, so it always means the pub the post names today; a post edited off
its venue carries no score.

Nothing adds scores across people. There is no venue average, no "top rated"
list and no score on the map. That is the line between this and the venue
ratings the beta contract keeps out: a review here is a sentence someone wrote
with a number in it, shown to the people who can read the post.

### 2. Your pubs, ranked, and your lot's

`read_own_social_pub_ranking` answers one row per pub the author has scored
(the newest score), best first.

The captain then asked for the friends' ranking (17 Oct 2026), and
`read_lot_social_pub_ranking` (migration `0184`) is the ONE aggregate this
ADR allows. For one reader it averages each mutual friend's newest score per
pub, best first, over posts that reader may already read, never their own
score, never a blocked author. It is answered to that reader alone, writes
nothing, and no venue rating, price, map layer or feed order reads it. A
city-wide or public "top rated" list stays out.

### 3. One video per post, held until a person watches it

A post carries one photo or one video, never both. A video:

- goes from the browser straight to Storage against a one-off upload intent
  (`create_social_video_upload`), because a phone video is far larger than a
  serverless request body;
- is checked by its leading bytes and stored size before the post is created,
  so a declared type is never taken on trust;
- is shown to its author at once and to everybody else only after a moderator
  approves it in the admin console, because nothing screens video the way
  `lib/socialPostModeration.ts` screens text and photos;
- is served through `/api/social/videos/:postId`, which checks the reader
  against the post on every request and then hands the player a two-minute
  signed Storage URL. `media-src` admits that one origin.

The limits are 100 MB and ten minutes.

### 3a. Which did you prefer?

A person can also build their own order the way Beli does (migration
`0186`). They put a pub in a band (loved it, it was fine, not for me), then
answer "which did you prefer?" against pubs already in that band. The
questions are a binary search in the browser, so a band of n pubs takes
about log2(n) taps. Only the result is stored: the band and an ordering key.
The server places the pub between the two neighbours the answers found and
refuses if they are no longer adjacent, so a second tab cannot interleave a
wrong order. The 0-10 figure beside each pub comes from its band and place
on every read (`lib/socialPubRankings.ts`) and is never stored.

Once a person has compared any pub, "Yours" shows this order; until then it
shows their star scores. Like the star ranking, it is theirs alone: no venue
rating, price, map or feed reads it, and it rides the account export as its
own lane.

### 4. Up to four photos, each screened on its own

The first photo keeps every rule 0074 gave it. Photos 2 to 4 live in
`social_post_extra_photos` (migration `0185`): one request each (so none
nears a serverless body limit), the same normalising pipeline, and their own
model check drained by the Social post cron. A pending or flagged photo is
shown to its author only; the post and its other photos stay up.

### 5. The card is photo-first, the feed is not ranked

The card reads like a photo app: who and where, the media edge to edge at 4:5,
then Cheers, comments, save and report, then the score and the words. Reels
open full screen and swipe vertically. The feed's order is unchanged: newest
first, in the same three lanes.

### 6. A pub's own page, laid out like a booking app

`/pubs/[id]` shows one pub the way a restaurant app does: the photo, the name,
the area and the cheapest pint, one filled action, then pints and prices,
opening hours, what is there, your lot on this pub, the story, the photo wall
and visit reports. Every line is a fact the venue record already holds, and a
fact it does not hold prints nothing. The filled action is "Book a table" only
when the pub publishes a booking page, and it links out to that page: nothing
is booked or paid for here. Otherwise it opens the pub on the map. "Rank it"
starts the which-did-you-prefer flow on this pub. The page is reached from a
post's pub name (like a location tag), a reel's pub name, a row in Your pubs,
ranked, and "See the full page" on the map's pub sheet.

"Your lot on this pub" (migration `0187`) is the lot ranking narrowed to one
pub and opened to the posts: mutual friends' scored posts the reader may
already read, newest first, with each friend's newest score averaged. It is
read for one reader and never shown to anyone signed out, so it is still not
a public rating.

`/ledger/[id]` stays the large-print logbook and the canonical, indexed
permalink. The new page sets its canonical to the ledger and is not indexed.
Swapping the two in the sitemap is the captain's call, not this change's.

## Consequences

- Six migrations for the captain to apply: `0182` to `0187`, each with a
  rollback. Without them the stores fall back to process memory outside
  production and refuse writes in production, like every other Social store.
- The video lane adds a moderation queue someone has to watch. Until they do,
  a video stays with its author, which is the safe failure.
- Signed playback URLs live for two minutes. A copied URL outlives a block or
  an audience change by at most that long; photos keep their stricter
  same-origin byte path.
- Not built here: booking or payment inside PUBMAXX, and any aggregate beyond
  a reader's own lot. Either needs this ADR changed first.
- Removing a post keeps its extra photos' objects in Storage, as the first
  photo's detach lifecycle does not yet cover them; a sweep of
  `social-extra/` for removed posts is follow-up work.
