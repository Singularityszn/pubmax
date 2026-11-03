# One good London night: the overnight build of 3 to 4 November 2026

Status: DATED RECORD, CAPTAIN DECIDES THE DEPLOY.
Base: `origin/main` at `35cc1a7d` (3 Nov 2026). Production runs `0cafcb24`, 15 commits behind.
Deploy target: the morning of 4 Nov 2026.

## 0. Read this first

**The goal:** one person chooses a night, sends one useful link, meets their friends, and wants
to use PUBMAXX again.

**This build does two things:**

1. It makes the best finished work normal. Wave A fixes one price bug and promotes four "wild"
   pieces that already exist behind `?wild=1`.
2. It adds seven new night ideas behind the existing wild switch (`lib/useWildMode.ts`). Wave B
   reaches production but stays hidden until the captain turns a piece on.

**Why this is safe for a morning deploy:**

- No migration. No new table. No new API route, except where a slice says so.
- No new analytics event name. (A new name needs its emitter in the same commit, see
  `docs/AGENTS.md`. That work waits for the next build.)
- Every Wave B surface renders nothing unless wild mode is on.
- Every PR owns its own files (section 5). Parallel worktrees do not collide.

**Rules every PR keeps** (from the root `AGENTS.md` and its area files; read the nearest
`AGENTS.md` before you edit):

- `npm run verify` passes on the final head. A failing or flaky test is yours to fix.
- Copy follows `docs/VOICE.md`: British spelling, no em dash, no exclamation mark, no joke beside a
  price, a date, a source or an accessible name.
- Every price shows its serving, its source and its date. A missing fact says that it is missing.
- No fabricated price, opening hour, train time or pub history. Pub Pal and Tarot read only
  sourced facts, and fail closed.
- A route and API ceiling in `perf/` comes down, never up. Wild components load with
  `next/dynamic` so their code stays out of the first page load.
- Light and dark theme, keyboard use, reduced motion, large text and a 390 px phone width all work.
- A commit has no agent trailer. The PR body has a before and after screenshot for any visible change.
- Nothing a drinker uses goes behind a price, a tier or a referral count.

## 1. Slice 0: deploy what main already has (captain, before anything else)

Main has 15 merged commits that production does not run. They include Phase 0 design fixes
(#2471), the ten wild ideas (#2466), the Pub Pal food memory (#2472), the founder story (#2473)
and the dependency bumps (#2476, which takes `@anthropic-ai/sdk` to a new major version).

The captain can do one of two things:

- **Option 1 (recommended): deploy main tonight**, then deploy this build in the morning. Two small
  deploys are easier to roll back than one large deploy.
- **Option 2: deploy everything in the morning** as one release.

Before either deploy, one agent runs these checks on `origin/main` and posts the result in a
`ready-for-human` issue:

1. `npm run ci` (verify plus build).
2. `/api/heritage` and Plan generate still answer, because of the SDK major bump.
3. `npm run e2e:cli` shots of Home, Map, Plan, Tonight and one pub page, phone and desktop.

## 2. Wave A: make the best existing work normal (must merge before the freeze)

### A1. One rule for a comparable pint price

**The bug:** on the Soho area sheet, The French House's £3.40 half pint wins "cheapest pint".
Its venue sheet correctly says "Not a pint price."

**The cause:** `verifiedPrice` in `lib/areaButton.ts` reads `venue.latestContributorPrice ??
venue.cheapestPrice` and never asks about the serving. Community drops already pass
`measureIsPint` (`lib/venues.ts`, `isPintPricedDrop`), but a curated anchor such as
`anchorLabel: "Half pint house lager"` does not. The correct rule already exists, but only in a
build script: `isSourcedPint` in `scripts/build_last_orders_pack.mjs`, pinned by
`__tests__/lastOrdersList.test.ts`.

**The work:**

1. Add one policy leaf, `lib/comparablePint.ts`, that answers "may this venue's figure compete in a
   cheapest-pint answer?". It refuses a non-pint measure, a half or other anchor label, a figure
   with no source and a figure with no full day. Use the `isSourcedPint` rule as the starting
   point, and keep the script and the leaf in step (the script may import the rule, or a parity
   test holds them equal).
2. Use the leaf in every cheapest-pint ranking: `lib/areaButton.ts` (`verifiedPrice`),
   the cheapest sort in `components/map/MapSplitList.tsx` and `components/map/MapVenueList.tsx`,
   `components/map/ControlRail.tsx` (the `<= 5.5` filter), `lib/tonightCheapPints.ts` and
   `lib/nearCheapestAnything.ts` where it ranks pints. Search for other
   readers of `cheapestPrice` in a ranking and list each one in the PR body.
3. A refused venue stays on the map, in the list and on its own sheet, with its serving shown.
   It only loses the right to win a cheapest-pint answer.

**Done when:** a test proves The French House stays findable but cannot win cheapest pint in
Soho, on the area sheet, the list sort, Near or Tonight. Add a fence test that fails if a new
cheapest ranking reads `cheapestPrice` without the leaf.

### A2. Plan starts with "describe tonight"

`app/plan/page.tsx` renders `<PubListImport />` above `<PlanComposer />`. Swap the order, so the
describe-first screen comes first. Show the import as a quiet secondary link or fold below it
("Already have a list of pubs?"). Check `__tests__/planDiscoverability.test.ts` and update only
the assertion about order.

**Done when:** on a 390 × 844 phone, the first screen of `/plan` shows the describe field and the
primary action, and no import control above them.

### A3. Pint Line and the crawl receipt become normal on crawl pages

Today `components/wild/PintLineGate.tsx` and `components/wild/CrawlReceiptGate.tsx` render only in
wild mode on `app/routes/[slug]/page.tsx`.

1. Render both for everyone on `/routes/[slug]`.
2. Check the receipt says what it adds up: the selected serving at each stop, as a subtotal. It is
   not the full spend of the night, and it never divides a per-person figure by group size.
   A stop with no price shows "No price yet" and is left out of the subtotal, and the receipt says
   how many stops it left out.
3. Keep the real walking map on the page. Pint Line is the diagram, not the map.

**Done when:** Victorian Soho shows the Pint Line and the receipt with wild mode off, and the
receipt matches the prices on each stop's sheet.

### A4. Sign Foundry: every pub has a face

`components/wild/PubSignSlot.tsx` and `lib/wildPubSign.ts` draw an illustrated pub sign in wild
mode. Make it the normal fallback when a venue has no usable photo, in the venue sheet header and
the list thumbnail (`components/media/VenueImage.tsx` is the likely seam).

- A real photo always wins.
- The sign carries the real name and area only. It never shows a founding year unless the record
  has a sourced one.
- The sign must not look like a photo. Give it an accessible name such as
  "Illustrated sign for The Nellie Dean", and no photo credit line.

**Done when:** a pub with no photo shows the same sign in the list and on its sheet, in light and
dark themes, and a pub with a photo shows the photo.

### A5. Beer mats on Tonight, on phones

`app/tonight/TonightCheapPints.tsx` picks `<BeerMats>` in wild mode and `<TonightPintBelt>`
otherwise. Make beer mats the default below 600 px and keep the belt on wider screens. Beer mats
must keep the price, serving, source and date readable, and work with reduced motion (no flip,
just show the back).

**Done when:** Tonight on a 390 px phone shows the mats, the mats read the same rows as the belt,
and a keyboard user can turn each mat.

### A6. Social never opens on an empty room

`app/social/SocialPageClient.tsx` and `app/social/SocialLondonLane.tsx`: when the London feed is
empty, lead with things that are real today: the named crawls (`/routes`), the newest dated
prices and a "Plan a night" action. Never make posts, attendance or popularity up. Sign-in moves
below this, as an offer, not a wall.

**Done when:** a signed-out visitor on an empty feed sees three real next actions above the
sign-in offer, and `__tests__/frictionVoice.test.ts` still passes.

## 3. Wave B: the wild night (behind `?wild=1`, ships dark)

Each idea is one PR, rendered only when `useWildMode()` is true, loaded with `next/dynamic`, and
built on data the tree already holds. If a slice finds that its data does not exist, the agent
stops, writes what is missing in the PR body, and ships nothing for that idea.

### B1. Last Tube Clock

Each person in a planned night can add their home station (stored on their device only, never
sent with the plan). The night shows each person's leave-by time from the current stop.

- Reuse `/api/last-train` and `app/tonight/useTonightGetHome.ts`. No new transport source.
- When the answer is not ready, say "No last-train time for this station yet". Never guess a time.
- Reuse the live clock (`lib/useLiveClock.ts`) so "Leave in 10 min" becomes "Leave-by time has
  passed" on time.

Seam: Night mode (`components/night/NightModeCard.tsx`).

### B2. Latecomer Beacon

A guest who opens the invite after the night started sees "The crew is at The Lamb now" and a
walking route from where they are to that stop.

- "Now" is the current stop from Night mode or The Round's current stop (`lib/roundPresence.ts`).
  If neither is known, show the full route instead. Never guess a stop.
- Location permission is asked only when the guest taps "Walk me there".

Seam: `components/plan/InvitePageView.tsx`, `components/plan/PlanInviteOpened.tsx`.

### B3. Round Rota

A turn tracker for "whose round is it". The host adds names, and one tap moves the turn on.

- Turns only. No money, no amounts, no payment, no debt language.
- State lives on the device (or in The Round's members if that is already shared and simple).

Seam: Night mode or `components/round/`.

### B4. Pub Tarot

A skin on the existing pint roulette on Near (`components/nearme/NearPintRoulette.tsx`,
`lib/pintRoulette.ts`, `lib/pintRouletteFacts.server.ts`):
draw three cards, "Where you were", "Where you are", "Where you are going". Each card is a real
pub with one sourced fact (price with serving and date, or a heritage line with its source).

- No fortune text that states a fact. The fun words go in the card titles only.
- A pub with no sourced fact cannot be drawn.

### B5. Your Crew's Tube Line

A private poster for a crew: each completed night is a station on the crew's own line, drawn in
the Pint Line style (`lib/wildPintLine.ts`), with each pub's Sign Foundry sign.

- Reads completed nights the crew already has (the usual-crew and morning-return data). Only
  members of that crew can see it.
- Before 2 nights, show "Your line starts after your second night out".

Seam: the completed plan and recap (`components/plan/CompletedPlanUsualLot.tsx`,
`components/plan/RecapDetail.tsx`).

### B6. Borough Bingo

A 32-square card of London boroughs (City of London as the free square, labelled as such). A
square is marked when the person's Been list (`lib/beenHere.ts`, `lib/profilePassport.ts`) has a
pub in that borough.

- Private to the person. No leaderboard.
- Each marked square links to the pub that marked it.

Seam: `components/profile/PassportSections.tsx`.

### B7. Tonight's B-side

When rain is forecast for the night's window, the host sees one alternative route with more
covered or shorter walking legs, built through Sliding Doors (`components/plan/SlidingDoors.tsx`).

- The host must accept it. Guests see it only after the host accepts.
- Use the weather data the tree already reads (`app/tonight/TonightConditionsStrip.tsx`). If there
  is no forecast, show nothing.

## 4. Not in this build (write down, do not build)

| Idea | Why it waits |
|---|---|
| **Price Heist** (a crew finds a cheaper pint and posts a dated menu photo) | It needs photo moderation and a new submission path. Plan it on top of Pint Drops. |
| **Hold-a-Table** (a host asks a venue for a table) | It belongs to the venue rail. Platform prep is ADR-only (`docs/adr/0011-venue-operator-rail.md`). |
| **Night liner notes, Morning After Gazette, fork and rejoin** | Already in earlier plans. Each needs its own privacy design. |
| **New home page with a static London map** | Too large for one night. Do it after the pilot shows what new visitors need. |
| **New analytics events for Wave B** | Register each name with its emitter in the commit that turns a piece on for everyone. |

## 5. Who owns which files

One agent, one worktree, one branch and one PR for each row. Cut each branch from `origin/main`.
If your slice needs a file in another row, stop and write that in your PR body. Do not edit it.

| PR | Branch | Owns |
|---|---|---|
| A1 | `codex/a1-comparable-pint` | `lib/comparablePint.ts` (new), `lib/areaButton.ts`, `lib/tonightCheapPints.ts`, `lib/nearCheapestAnything.ts`, `components/map/MapSplitList.tsx`, `components/map/MapVenueList.tsx`, `components/map/ControlRail.tsx`, `scripts/build_last_orders_pack.mjs` |
| A2 | `codex/a2-plan-describe-first` | `app/plan/page.tsx`, `app/plan/plan.css`, `components/plan/PubListImport.tsx` |
| A3 | `codex/a3-pint-line-receipt` | `app/routes/[slug]/page.tsx`, `components/wild/PintLine*`, `components/wild/CrawlReceipt*`, `lib/wildPintLine*.ts` |
| A4 | `codex/a4-sign-foundry` | `components/wild/PubSign*`, `lib/wildPubSign.ts`, `components/media/VenueImage.tsx` |
| A5 | `codex/a5-beer-mats` | `app/tonight/TonightCheapPints.tsx`, `components/wild/BeerMats.tsx`, `components/wild/beerMats.css` |
| A6 | `codex/a6-social-first-screen` | `app/social/SocialPageClient.tsx`, `app/social/SocialLondonLane.tsx`, `app/social/social.css` |
| B1 | `codex/b1-last-tube-clock` | new files under `components/wild/`, one mount line in `components/night/NightModeCard.tsx` |
| B2 | `codex/b2-latecomer-beacon` | new files under `components/wild/`, one mount line in `components/plan/InvitePageView.tsx` |
| B3 | `codex/b3-round-rota` | new files under `components/wild/`, one mount line in `components/round/` |
| B4 | `codex/b4-pub-tarot` | new files under `components/wild/`, `lib/wildTarot.ts` (new), one mount line in `components/nearme/NearPintRoulette.tsx` |
| B5 | `codex/b5-crew-tube-line` | new files under `components/wild/`, one mount line in `components/plan/RecapDetail.tsx` |
| B6 | `codex/b6-borough-bingo` | new files under `components/wild/`, `lib/wildBoroughBingo.ts` (new), one mount line in `components/profile/PassportSections.tsx` |
| B7 | `codex/b7-b-side` | new files under `components/wild/`, one mount line in `components/plan/SlidingDoors.tsx` |

**Shared files nobody edits in this build:** `lib/analyticsEvents.ts`, `docs/DESIGN_SYSTEM.md`,
`docs/VOICE.md`, any `perf/` ceiling, `package.json`, the lockfile and `supabase/`. B1 and B2 both
mount in Night mode files. If they touch the same file, B2 rebases on B1 after B1 merges.

## 6. Merge order and the freeze

1. A1 first, because A5 reads its rows and every price surface depends on it.
2. A2, A3, A4, A6 in any order.
3. A5 after A1.
4. Wave B in any order. A Wave B PR that is not green at the freeze waits for the next deploy. It
   does not block the release.

The captain sets the freeze time. After the freeze, nothing merges except a fix for a red check.

## 7. The morning release check

One agent runs this on the merged head and posts the result to the captain before the deploy:

1. `npm run ci` passes.
2. `npm run e2e:cli` before and after shots: Home, Map (Soho area sheet), Plan, Tonight, Social,
   Victorian Soho, one pub with a photo, one pub without. Phone and desktop, light and dark.
3. The French House is on the map and cannot win cheapest pint.
4. With `?wild=1`, each merged Wave B piece renders. Without it, none render.
5. Route budgets in `perf/` hold.

**After the deploy:**

1. `/api/version` reports the release commit.
2. Repeat checks 3 and 4 on production.
3. If a check fails, roll back in Vercel to the previous production deployment, then fix forward.

## 8. After the deploy: the pilot

Start the 10-crew pilot from `docs/plans/CREW_NIGHT_LOOP.md` in Soho, Shoreditch and London
Bridge. Turn on one Wave B piece at a time for pilot crews only (by sending them a `?wild=1`
link), and ask each crew what they used. Make a piece normal only when crews use it. The targets
stay as approved: 30% of plan makers send a link on the first visit, 30% of invites get an RSVP or
map open in 24 hours, and 20% of crews plan again in 14 days. These are targets, not results.
