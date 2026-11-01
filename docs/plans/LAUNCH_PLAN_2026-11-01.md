# Launch plan, 1 November 2026

A dated record. The captain asked three questions: is the app ready for Product Hunt today, what is missing in UI, UX, design, speed, reliability and cost, and what do Beli, OpenTable and Airbnb have that PUBMAXX does not. The captain answered 15 decision questions and approved this plan on 1 November 2026. It extends the waves in [`PLG_STRATEGY.md`](PLG_STRATEGY.md) and follows on from [`LAUNCH_REVIEW_2026-10-30.md`](LAUNCH_REVIEW_2026-10-30.md). It does not start a parallel roadmap.

Sources: the code at `deb0cd2d`, the 30 October launch review, three read-only code reviews, live PostHog data, the live site and committed screenshots from 23 to 30 October.

Not done: the Mobbin connector refused every search ("requires a paid plan"), so it is not linked to the captain's Pro account. The competitor rows below come from web research and product knowledge. Reconnect Mobbin with the Pro login to pull reference screens.

---

## 1. Verdict: do not launch on 1 November. Launch on Tuesday 17 November.

| Fact | Evidence on 1 November |
| --- | --- |
| Production runs an old build. | `/api/version` returns commit `e5da6c0`. Main is about 400 commits ahead. |
| Migrations 0203 to 0216 are not applied. | Open crawls, kitchen reports and the "That's wrong" door need them. |
| Almost nobody uses the app yet. | PostHog, last 30 days, test accounts removed: 25 visitors, 4 plans made, 2 crawls locked, 5 sign-ins. |
| The north-star events do not fire in production. | `plan_invite_sent`, `plan_accepted` and `crew_committed` are absent from the last 30 days. |
| The map is slow to become usable. | First tappable pin: 14 s on desktop and 21 s on a phone, on a test box. An 8 s map-style timeout is the likely cause. |
| The database has no backups. | Supabase free plan. One weekly dump from a Mac. |
| Nobody can be brought back. | Email is not built (`lib/emailProvider.ts`). Plan push is a stub (`lib/pushSender.ts`, `TODO(push-identity)`). |
| Monitoring is mostly off. | No uptime monitor. `PUBMAX_ALERT_WEBHOOK_URL` is not set in the production project. The emergency contact list is blank. |

What is good: a keyless plan link takes 4 taps. The data is honest and dated. Real-user mobile LCP at p75 is under 2.5 s on every page in the last 30 days (small sample). Most of the 30 October hygiene list is fixed in the code.

---

## 2. Captain decisions, 1 November 2026

| # | Decision | Effect |
| --- | --- | --- |
| 1 | Launch on Product Hunt in 2 to 3 weeks. | Tuesday 17 November, 00:01 Pacific (08:01 UK). |
| 2 | The launch story is "the hunt for the UK's cheapest drink", playful and wacky. | New hero, tagline and playful surfaces (section 3). |
| 3 | Frame it as "UK hunt, London deep". | Every claim shows a real, dated price. A city with no prices says so. The anti-goal line in the root `AGENTS.md` changes in the same commit as the new hero. |
| 4 | Keep every surface visible. | Nothing is hidden. The fix is order and navigation. |
| 5 | Mobile web first. | No store apps at launch. |
| 6 | Stay on the Supabase free plan. | Free mitigations in section 6, item R1. The risk stays. |
| 7 | Signed-out visitors can read a London lane on Social. | Read-only. Writing still needs sign-in. Closes decision D2 of the launch review. |
| 8 | Route A: a third-party age check before a person can post, comment or send a DM. | Needs a vendor account and legal advice before it goes live. Closes the age-assurance decision. |
| 9 | A typed price without a receipt saves as "logged by @handle, not checked". | It shows on the venue. It does not colour the pin until a receipt or a second person confirms it. ADR 0010 needs an amendment. |
| 10 | Offer pubs a free claimed page, group booking requests, posters and beer mats, and paid slots. | A paid slot follows [`SPONSORSHIP_POLICY.md`](../SPONSORSHIP_POLICY.md): a "Sponsored" label, an isolated slot, never a higher rank or a pin colour. |
| 11 | Venue photos come from pubs and drinkers. | Pub onboarding asks for 3 photos. The visit and price flows ask for one. |
| 12 | Beta crews come from the captain's circles, university societies, quiz teams and hosted public crawls. | 20 to 30 crews before launch. |
| 13 | Mobile navigation becomes 5 tabs, Airbnb style. | Explore, Tonight, Plan, Social, You. Pal moves to the top bar and inside Explore and Plan. The floating + button goes. |

Still open: Clerk (removal recommended), and the pint refresh day (every Monday recommended, with the date printed on the site).

---

## 3. The launch story

The honest base: London has about 1,000 priced pubs. `public/data/uk_prices/rows.json` holds 5,038 listed drink prices at 3,233 venues, mostly Greene King menus and pubs' own websites. Wetherspoon prices cover their UK pubs. 2,948 further rows are London estimates. An estimate is never called "cheapest". Only a listed or confirmed price can win a "cheapest" line.

Hero: one live card, "The cheapest pint we can find in Britain right now", with the pub, the price, the source and the date. It replaces the stock London photograph in `components/landing/LandingHero.tsx`.

Playful surfaces, most of them built already:

- Cheapest anything: Guinness, house wine, Coke, coffee and alcohol-free near you.
- Britain's cheapest pint, city by city, each with its date. A city with no price says "No prices yet. Log the first one." It is a list of prices, not of drinkers.
- London's dearest pint, as a press story, never as a pin colour.
- Pint roulette, the £20 crawl, the pint price time machine, Dog of the week, the crawl name generator and pub crawl bingo.

---

## 4. The journey from first visit to habit

| Stage | Gap | Fix |
| --- | --- | --- |
| Arrive | A stock photo. The first card is a far-away pub. The floating + button covers it. | The live "cheapest in Britain" card. Remove the floating + button. |
| Aha | The map takes 14 to 21 s to give a tappable pin. | First pin in under 3 s (S1). |
| Commit | "Import a pub list" is the first thing on `/plan`. | The describe field first. |
| Bring | No reminder reaches a guest on the day. | Email reminders and plan push identity. |
| Night | Rounds are hard to find. | Show Rounds inside night mode. |
| Keep | No "Been" map at first run. | Optional card: "Tap the pubs you have been to". |
| Return | No email, no social push, no "follow a pub". | Weekly digest by email, push for invites and replies, follow a pub. |

The loop to prove in the beta: a crew plans, goes out, gets a recap, and plans again within 14 days (the Wave 3 line).

---

## 5. UI, UX and design

| From | Pattern | PUBMAXX on 1 November | Do |
| --- | --- | --- | --- |
| Airbnb | 5 tabs | 6 tabs, a raised Pal button and a floating + button | 5 tabs (decision 13) |
| Airbnb | Desktop list and map side by side | The list is a small floating panel (`components/map/MapVenueList.tsx`) | Split view on Explore, `/near` and `/pubs` |
| Airbnb | Photo-first cards | Most sheets say "No photo yet" | Pub and drinker photos, and a designed no-photo state |
| Airbnb | Price pills on a calm map | "from £6.15" stamps on a busy basemap | Pill markers and a muted basemap |
| Airbnb | One sticky action card on the detail page | About 30 blocks in 5 folds on the venue Overview | One sticky card: price, walk time, "Add to plan", "Ask for a table" |
| Beli | Log places you have been at first run | Web onboarding asks nothing | Optional "Been" card |
| OpenTable | Book a table, reminder, change or cancel | Booking deep links only | "Ask the pub for a table" for crews of 6 or more |
| Partiful | Day-of reminders on the invite | No reminders | Email reminder |

Already built or refused: see the Beli parity ledger in [`WEEK1_HYGIENE_BUILD_2026-10-30.md`](WEEK1_HYGIENE_BUILD_2026-10-30.md) section 2. Streaks, match scores, consumption leaderboards and invite unlocks stay refused.

Desktop: the split view first, then a top bar of about 8 controls (it holds about 12), Messages as two panes, and a smaller consent bar.

---

## 6. Speed, reliability and cost

Speed:

- S1. First tappable pin in under 3 s. Start with the 8 s style timeout in `components/map/canvas/tokens.ts`. Self-host a London PMTiles file, which also removes the CARTO fallback the code says is not free for commercial use.
- S2. Stop loading the full 1.2 MB venue file on `/crawls`, rounds, the drink wall and night mode.
- S3. Add a budget and a vitals row for `/plan/[id]`, the page every shared link opens.
- S4. Fix the breaches on `/today`, `/social` and `/pal/chat`.

Reliability, on the free plan:

- R1. The off-platform dump on the captain's Mac runs every night instead of every Sunday (shipped, section 9), so a loss takes at most a day once `npm run backup:install-launchd` runs again. The dump stays off GitHub, because the repository is public and `docs/DR_RUNBOOK.md` forbids a dump on an Actions run. One restore drill sets the recovery time. Upgrade the database plan on launch day if the spike is large.
- R2. Fewer database calls per visitor. Hidden map tabs no longer poll (shipped, section 9). The rate-limit fallback in `lib/pintDrops.ts` drops every key to 3 requests a minute when the database is slow; read-only routes should fail open with a local limit.
- R3. A free uptime check on `/api/health`, the alert webhook set, PostHog alerts on `$exception`, and the emergency contacts filled in.
- R4. A load test on a preview: 500 map opens and 100 plan links in 5 minutes.

Cost:

- C1. Money caps at each vendor (OpenRouter, ElevenLabs). The code caps requests, not money.
- C2. Move the anonymous Ask and heritage lane to a cheaper model.
- C3. Remove Clerk and `convex/` once the captain confirms.
- C4. Confirm the Vercel plan; the every-minute cron needs Pro.

---

## 7. Pubs

1. Free claimed page. Blocker: accepted operator proposals are saved but never shown (`app/api/operator-proposals/route.ts`). Store them, read them on the venue sheet and on Tonight, and move `components/operators/OperatorRailPanel.tsx` to the venue sheet behind "Run this pub?".
2. Posters and beer mats ([`POSTER_SPEC.md`](../growth/POSTER_SPEC.md)).
3. Group booking requests by email. Free now; a fee for each seated group later, under ADR 0011.
4. Sponsored slots last, after 30 claimed pubs, through `lib/sponsorship.ts`.

Target before launch: 30 claimed pubs in Soho, Shoreditch and Hackney, and Clapham, each with 3 photos and one regular night.

---

## 8. Schedule

- Week 1, 2 to 8 November. Captain: apply migrations 0203 to 0216, deploy main, set vendor money caps, open the age-check vendor account, book legal advice. Agents: S1, S3, R1 to R3, email, plan push, the read-only Social lane, the unchecked-price rule, the 5-tab navigation, the operator proposal reader. Beta: 10 crews from the captain's circles.
- Week 2, 9 to 15 November. Agents: the new hero and playful surfaces, the desktop split view, the sticky venue card, pill markers, "Ask the pub for a table", the "Been" card. Beta: 20 to 30 crews. Pubs: 30 claimed pages and posters. Marketing: Product Hunt assets, a hunter, a press pitch ("London's cheapest and dearest pint").
- Week 3, 16 to 22 November. Monday: freeze, then the launch-head sweep and smoke walk on production. Tuesday 17: Product Hunt at 08:01 UK, with r/london, TikTok street videos, the press story, university societies and pub posters on the same day.

---

## 9. Shipped with this record (PR #2454)

Week 1 agent work, built on 1 November 2026 and held on one branch for review:

- Demo content is opt-in: `NEXT_PUBLIC_DEMO_CONTENT=on` only, in lists and by id. A sensitive Vercel value once read as `[SENSITIVE]` turned it on.
- Hidden tabs no longer poll for Pint Drops (`visibleInterval`, `lib/visiblePolling.ts`), and one owed catch-up read survives the live channel joining.
- A new conversation needs mates until the age check is live (decision 8). An existing thread keeps working.
- Signed-out visitors can read a London lane on Social (decision 7). Handles only, no faces.
- A typed price without a bill saves as "not checked" and never colours a pin alone (decision 9). Migration 0218.
- Accepted pub operator updates are stored and shown: "From the pub" on the venue sheet and "From the pubs tonight" on Tonight. Migration 0217.
- Email sends through Resend once the keys are set. Nothing calls it yet; the digest stays off.
- The off-platform backup runs every night.
- The phone has five tabs (Explore, Tonight, Plan, Social, You), the Pal sits in the top bar, and the floating + button is gone (decision 13).

Not shipped: an edge cache for `/api/whats-on`, because it conflicts with the shared-cache rule in `__tests__/sharedCacheHonesty.test.ts`. Still to build from week 1: map first pin under 3 s (S1), the `/plan/[id]` budget (S3), plan push identity, the rate-limit fallback (R2) and monitoring (R3).

---

## 10. How to know it works

| Measure | Bar for the first 2 weeks after launch |
| --- | --- |
| Plan makers who send a link in their first visit | 30% or more |
| Invites with an RSVP or a map open within 24 h | 30% or more (Wave 1) |
| Crews that plan again within 14 days | 20% or more (Wave 3) |
| Prices logged each week | Rising every week |
| Claimed pubs | 30 at launch, 100 by Christmas |

Before launch, confirm that `plan_invite_sent`, `plan_accepted`, `crew_committed` and `plan_completed` arrive with `environment = production` from the new deployment.
