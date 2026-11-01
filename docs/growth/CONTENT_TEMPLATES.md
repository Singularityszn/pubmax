# Short-form content templates (owner channel)

Cycle 17, Lane D. Ten repeatable short-form video templates for the owner's
TikTok and Instagram, each driven by OUR data so nothing is invented and every
post is defensible. The owner records and posts; we keep the templates and the
data honest.

House rules for every template:

- Positioning: London runs on its pubs. This is the app that runs your night.
- The pub is a third place. Presence over optimization. Never anti-health, never
  a "drink more" angle. We talk about price, place, and heritage, not volume.
- Every number on screen must be sourced from the listed lib. If the data cannot
  support an honest figure, do not fake it: pick a different pub or area, or skip
  the post. Show the provenance label the app already renders (lib/provenanceLabels.ts).
- No em dashes in captions or on-screen text. Use commas or periods.
- Erin and Carol never appear. They are private individuals, not content.
- Show, do not tell: film the real screen in the app, both themes fine, reduced
  motion.

Each template lists the exact data source lib to pull the fact from.

---

## 1. Cheapest pint today

- Hook: "The cheapest pint in London right now is..."
- Format: hold on the borough at the bottom of the league table, then reveal the
  price and the pub.
- On screen: pub name, price, borough, provenance label.
- Data source: `lib/pintIndex.ts` (`buildLeagueTable`, `indexSummary`) over
  `lib/zonePintIndex.server.ts`; per pub figure from `lib/pintFacts.ts`.
- CTA: "The whole league table is in the app."
- Provenance: show the sourced-and-dated label; never say "live".

## 2. Pub of the day fact

- Hook: "You have walked past this pub a hundred times. Here is what happened
  inside it."
- Format: exterior or interior shot, one heritage fact on screen, source credited.
- On screen: one fact, the pub, the citation (Wikipedia, Wikidata, or NHLE).
- Data source: `lib/heritageFacts.ts` for the sanitised fact; `lib/heritage.ts`
  for the full record; `lib/heritageListings.ts` for listed-building status.
- CTA: "Every pub in the app carries a fact like this."
- Provenance: name the source out loud. One fact, one source, never invented.

## 3. Quiz night picks

- Hook: "Three quiz nights worth leaving the house for this week."
- Format: three quick cards with source-listed time evidence on each.
- On screen: venue, night, quiz badge, and the exact start only when the source
  supplies one; otherwise use its human-readable listed time.
- Data source: `lib/whatsOn.ts` (`WHATS_ON_KINDS`, the quiz kind) via
  `lib/whatsOnStore.ts`; badge copy from `lib/whatsOnBadges.ts`.
- CTA: "What is on across London tonight is in the app."
- Provenance: only list rows that carry a real source and usable time evidence;
  skip anything unsourced or untimed.

## 4. Drink-weather verdict

- Hook: "Beer garden or cosy corner? London, here is today's verdict."
- Format: point the camera at the sky, cut to the app's verdict card.
- On screen: the verdict, the honest staleness line if the snapshot is old.
- Data source: `lib/drinkWeather.ts` for the verdict; `lib/weatherSnapshots.ts`
  for the reading and its observed-at time.
- CTA: "The verdict updates in the app."
- Provenance: if the snapshot is stale, say so on screen. Do not imply live.

## 5. Borough league table reveal

- Hook: "I ranked every London borough by the price of a pint."
- Format: fast scroll from dearest to cheapest, land on the winner.
- On screen: borough rank, price per borough, the spread top to bottom.
- Data source: `lib/pintIndex.ts` (`buildLeagueTable`, `leagueTableToCsv`,
  `LeagueRow`).
- CTA: "Find your borough in the app."
- Provenance: reads per borough shown so viewers can trust the ranking.

## 6. Price of a pint over time

- Hook: "This is what a London pint has done to your wallet this season."
- Format: simple trend, then this month's figure.
- On screen: the series and the current average, dated.
- Data source: `lib/pintIndexSnapshot.server.ts` (dated snapshots) read through
  `lib/pintIndex.ts`.
- CTA: "We track this so you do not have to."
- Provenance: every point is a dated observation window, not a guess.

## 7. Historic pub of the week

- Hook: "The oldest thing on this street is the pub, and it is listed."
- Format: slow pan of the building, the listing detail on screen.
- On screen: pub, listed grade, one NHLE fact, the list entry link.
- Data source: `lib/heritageListings.ts` (NHLE listed status);
  `lib/boroughHeritage.ts` for the area context.
- CTA: "Its listing links straight from the app."
- Provenance: NHLE is Historic England, Open Government Licence. Credit it.

## 8. Tonight in London roundup

- Hook: "Everything worth doing in London tonight, in one app."
- Format: rapid cuts across quiz, sport, music, and a deal.
- On screen: four rows, each with venue and time.
- Data source: `lib/whatsOnStore.ts` windowed for tonight; `lib/tonight.ts`
  helpers for the window.
- CTA: "Open Tonight in the app before you head out."
- Provenance: each card shows its source; empty categories stay empty, no filler.

## 9. Cheap round, sorted

- Hook: "A three-stop crawl in London that keeps the round honest."
- Format: walk the route, price of the round on the crawl card.
- On screen: the stops, the round total, the map line.
- Data source: `lib/heritageCrawls.ts` for the curated route;
  `lib/pintFacts.ts` for the per pub price; `lib/shareArtifacts.ts` for the
  shareable crawl card.
- CTA: "Share the crawl card with your lot."
- Provenance: round total is the sum of sourced prices, never rounded up to sell.

## 10. Add your lot

- Hook: "Stop losing your mates in the group chat. Add your lot at the table."
- Format: two phones, one shares their link, the other taps add.
- On screen: the /add link, the confirm sheet, the "you are each other's lot"
  moment.
- Data source: `lib/crew.ts` for the crew model; `lib/inviteShare.ts` for the
  invite copy; the `/add/[handle]` share surface.
- CTA: "Share your link. When they add you back, you are each other's lot."
- Provenance: private by default. Nothing public unless you share it. Say so.

## 11. What does a pint cost here? (street video)

Added for the Product Hunt launch on 17 November 2026
(`docs/growth/LAUNCH_KIT_2026-11-17.md`). A person on the street guesses what a
pint costs in the pub behind them, then the app shows what the pub lists, who
listed it and the day we read it. The guess is theirs; the figure is the app's.

- Hook: "What does a pint cost here?"
- Format: one question, one guess, one reveal on the phone screen. Under 30
  seconds.
- On screen: the pub, the listed price, who listed it and the day the source
  was read, held long enough to read. If the pub has no price, the app's own
  empty line, never a guess of ours.
- Data source: the pub's sheet on the map (`lib/venuePriceLane.ts` for the
  wording), and for the hunt's figures `lib/cheapestHunt.ts`, printed by
  `npm run launch:figures`.
- CTA: "Every price in the app says who listed it and when."
- Provenance: say "listed" and "read on", never "live" or "today's price". A
  source read does not confirm what the bar charges tonight.

Rules for filming people, on top of the house rules above:

- Film only adults who clearly look over 25, and get a signed release from
  anyone who can be recognised. Blur everyone else.
- Never film anyone drinking heavily or who seems drunk. No "drink up", no
  "down it", no "another round".
- Film outside on the street. Inside a pub only with the landlord's yes,
  asked first.
- Before filming at a pub, check its price at the bar. If the bar charges
  something different from the app, say so on camera and log the new price
  with the bill. That correction is the video.
- [CAPTAIN: check the alcohol section of the CAP Code with the legal adviser
  you are booking for the age check before the first post.]

### Script A: guess the Soho pint

- 0 to 3 s. Outside a Soho pub, the pub's sign in shot, no faces but the
  guest's. Text:
  "What does a pint cost here?"
- 3 to 10 s. The guest guesses out loud. Text: their guess, as they said it.
- 10 to 20 s. The phone opens the pub on the map. The sheet's price, its
  source and its read day fill the frame.
- 20 to 25 s. Text: "Every price in the app says who listed it and when."
- If the pub has no price in the app, keep the shot: the sheet says "No price
  yet." Then the guest logs one with the bill, if they have bought a pint.

### Script B: the cheapest and the dearest

Two pubs, two guesses, filmed the same day. Use the recomputed figures F1 and
F2 from the launch kit, section 0.

- 0 to 3 s. Outside J.J. Moon's, Tooting. Text: "What does a pint cost here?"
- 3 to 8 s. A guess.
- 8 to 14 s. The app's hero card on the phone. Text: "£2.09. J.J. Moon's,
  Tooting. Listed by Pint Prices, source read 2 October 2026." [F1, recompute
  on 16 November]
- 14 to 17 s. Outside Baccarat Bar, Brompton Road. Same question.
- 17 to 21 s. A guess.
- 21 to 27 s. The venue's sheet on the phone. Text: "£9.50, a pint of Aspall
  Cyder. Listed by Pint Prices, source read 2 October 2026." [F2, recompute on
  16 November]
- 27 to 30 s. Text: "The cheapest we can find, and the dearest we hold."
- Check both prices at the bar before you film (launch kit, section 0, risks 1
  and 3). If either has moved, film the correction instead.

### Script C: your local

- 0 to 3 s. Anywhere in London. Text: "What does a pint cost at your local?"
- 3 to 10 s. The guest names their local and guesses its price.
- 10 to 22 s. Search the pub in the app. Show what the sheet says: the listed
  price with its source and read day, or "No price yet."
- 22 to 28 s. Text: "No price for your local yet? Log the first one." Only if
  the sheet really has no price.

---

## Posting cadence (suggested, owner-led)

- Two data templates a week (1, 5, 6, 8) keep the Pint Index angle alive.
- One heritage template a week (2, 7) is the evergreen bank; film several at once.
- One social template a week (3, 10) drives the crew loop.
- Weather (4) is opportunistic: post it on the first proper beer-garden day.
- The street video (11) runs three times on launch day, 17 November 2026, then
  once a week while people still stop to answer.
