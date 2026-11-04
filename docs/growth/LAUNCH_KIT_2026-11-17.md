# Launch kit, Product Hunt, Tuesday 17 November 2026

A dated record, written on 1 November 2026 for the launch the captain approved in
[`docs/plans/LAUNCH_PLAN_2026-11-01.md`](../plans/LAUNCH_PLAN_2026-11-01.md):
Product Hunt at 00:01 Pacific, which is 08:01 UK time, on Tuesday 17 November
2026. The story is the hunt for the UK's cheapest drink, framed "UK hunt, London
deep" (launch plan, sections 2 and 3). It extends the waves in
[`PLG_STRATEGY.md`](../plans/PLG_STRATEGY.md). It is not a parallel roadmap.

Two pieces live in their own homes, because a home already existed:

- Poster and beer-mat copy for the launch: [`POSTER_SPEC.md`](POSTER_SPEC.md),
  section "Launch variant, November 2026".
- The three "What does a pint cost here?" street videos:
  [`CONTENT_TEMPLATES.md`](CONTENT_TEMPLATES.md), template 11.

Everything else is below. The captain owns every post, pitch and send. Agents
keep this file and the figures honest.

## Contents

0. The figures, and how to recompute them
1. Product Hunt
2. Gallery and thumbnail
3. The 45-second film
4. Press
5. Community
6. Pubs
7. Seasonal hooks
8. Launch-day schedule, 17 November

---

## 0. The figures, and how to recompute them

### The rules every line in this kit follows

- Every price claim shows the price, the pub, who listed it and the day we read
  the source. A source read does not confirm the pub's price today, so a line
  says "read 2 October 2026", never "on 2 October 2026" and never "live".
- An estimate is never called "cheapest". Only a listed or confirmed price can
  win a cheapest or dearest line (`lib/cheapestHunt.ts`).
- "The cheapest pint we can find in Britain" keeps the words "we can find".
  The hunt reads London and the other cities on our map, and nothing else.
- A city with no prices says so. Nothing claims coverage the hunt does not show.
- No invented numbers, quotes, reviews, contacts or biography. Where the
  captain's own facts are needed, the kit says `[CAPTAIN: ...]`.
- Drinkers pay for nothing. A referral is a mark of honour, never a feature.
  The Year in Pints wrap is free forever. Nothing in this kit may promise
  otherwise.

### Figures as of 1 November 2026

Computed at 16:17 UTC on 1 November 2026 on the head at commit `fe8bfdc1`,
which carries the hunt fix `2b921c89` (a winner's price must have been seen at
that pub), with `npm run launch:figures` (`scripts/launch_figures.mjs`). These
replace the figures first written here at `bbd03ad6`. The script only reads
`lib/cheapestHunt.ts` and `lib/pricedPubCount.ts`, the same modules the front
door, `/about` and `/pint-index` read. It writes nothing and fetches nothing.
Every figure comes from the committed packs under `public/data`, so it needs
no key. The day matters as well as the commit: a confirmed price counts for 30
days and a listed one for 365 (`lib/priceTier.ts`), so a figure can age out
between two runs. That is one more reason to recompute on 16 November.

**Every `[F1]` to `[F4]` marker in this kit means: recompute on 16 November.**
Run `npm run launch:figures` on the launch head after the release, compare the
output with this table, and replace every marked figure that changed. Remove
the marker itself before anything is posted.

| Marker | Figure | Pub and drink | Source and read day | Map |
| --- | --- | --- | --- | --- |
| F1 | **£2.43**, the cheapest pint we can find in Britain (the front-door card). **A tie: 19 pubs in our London pub list stand in the hunt at £2.43**, and the card names this one by the tie-break. | J.J. Moon's, 553 Kingsbury Road, Kingsbury, NW9 9EL, in Brent (a Wetherspoon, by the source's own listing). The source names the drink "Bud Light". | Listed by Pint Prices on its page for this pub, source read 2 October 2026 | `https://pubmaxxing.com/map?sel=venue-cbqtvi` |
| F2 | **£9.50**, London's dearest pint: the venue in our London pub list whose cheapest pint is the dearest we hold | Baccarat Bar, 87-135 Brompton Rd, London SW1X 7XL. The source names the drink "ASPALL CYDER", so it is a pint of cider. | Listed by Pint Prices, source read 2 October 2026 | `https://pubmaxxing.com/map?sel=venue-3pjert` |
| F3 | **959 of the 2,033 pubs in our London pub list have a pint price on record.** | Not one pub. Use this exact sentence; it names its base. | The committed London list, menu bundle and update packs | `/about`, `/pint-index` |
| F4 | City by city (below) | | | |

F4, the city rows exactly as the hunt prints them:

| City | What the hunt says | Use it? |
| --- | --- | --- |
| London | £2.43 at J.J. Moon's, Kingsbury (F1), one of 19 London pubs at that price | Yes, always naming Kingsbury |
| Leeds | £3.80 at The Chemic Tavern. The source names "John Smith's". Listed by chemictavern.co.uk, source read 4 September 2026. | Yes |
| Liverpool | £3.70 at Shenanigans. The source names "Shenanigans Lager 4.0%". Listed by shenanigansliverpool.co.uk, source read 4 September 2026. | Yes, with care (see risks) |
| Oxford, Glasgow, Bristol, Cambridge | "Prices listed, but none says which pint." | Say exactly that |
| Manchester, Birmingham, Durham, Bath, Llandudno | "No prices yet." | Say exactly that (Birmingham: see risk 7) |

### Risks in the figures, read before quoting any of them

1. **F1 is now corroborated on the pub's own page.** Since the hunt fix
   `2b921c89`, a London figure can win only when the price site's own page for
   that pub showed it, or when it was read off the pub's own website
   (`huntPriceIsCorroborated`, `lib/cheapestHunt.ts`). The £2.43 Bud Light row
   at J.J. Moon's, Kingsbury, passes: Pint Prices' page for that pub showed it
   when we read the site on 2 October 2026. The first figure written here,
   £2.09 for Jaipur at J.J. Moon's, Tooting, failed that bar and is out of the
   hunt. A read is still not today's price, so before the press release goes
   out, [CAPTAIN: check the Kingsbury price at the bar, or in the Wetherspoon
   app, and log what you find with the bill]. If the bar charges more, the hunt
   moves, the release moves with it, and the honest correction is a better
   story than a wrong one.
2. **F1 is a tie.** 19 pubs in our London pub list stand in the hunt at £2.43
   (recounted from `londonHuntPints`; `npm run launch:figures` prints the
   count). All 19 were listed by Pint Prices and read on 2 October 2026, so
   J.J. Moon's, Kingsbury wins only on the rest of the hunt's tie-break: the
   name, then the id. There are several J.J. Moon's
   branches, and another of them, in Ruislip Manor, is also at £2.43. So every
   press and video line names Kingsbury, and where it fits says it is one of 19
   London pubs at £2.43 [F1]. Never "the cheapest pub in London", and never
   name the other 18 in copy without recounting them on the day. Separately,
   Pint Prices lists £1.99 Bud Light rows at several Wetherspoons. Any figure
   under £2.00 is read as a deal, a half or a typo and is held out
   (`PINT_PRICE_BAND_GBP`, `lib/priceRowEligibility.mjs`). A journalist may ask;
   the answer is that we do not call a figure under £2.00 a pint price.
3. **F2 is a cider at a bar, not a beer at a pub.** Baccarat Bar is in our
   London pub list, so the hunt counts it. Its address, 87-135 Brompton Road, is
   a department-store address. [CAPTAIN: confirm what the venue is before a
   journalist does.] The release says "Baccarat Bar" and "a pint of Aspall
   Cyder", never "a pub" and never "a pint of beer". The dataset's comment field
   on that row names `cheapestpint.uk`, so Pint Prices may have taken it from
   another site.
4. **"Cheapest in Britain" is only as wide as the hunt.** Five of the twelve
   cities have no prices yet and four more name no pint. A cheaper pint almost
   certainly exists somewhere we have not read. Always "the cheapest pint we can
   find", never "Britain's cheapest pint is in Kingsbury".
5. **The read days are old by launch.** London's two figures, £2.43 at
   Kingsbury and £9.50 at Baccarat Bar, were read on 2 October 2026, and the
   Leeds and Liverpool rows on 4 September 2026 [F1, F2, F4]. By launch day that
   is more than six weeks and more than ten weeks. Say the read day every time.
6. **Liverpool's source is a loosely parsed menu.** Other rows from the same
   Shenanigans page read "WKD Blue 3.4%" as vodka and a breakfast line as a soft
   drink. The lager row itself reads cleanly. Quote it only with its source and
   read day.
7. **Birmingham now shows "No prices yet."** The hunt holds out a row whose
   source page names another branch, so The Botanist Gas Street Basin's figure,
   read off the chain's Barnsley page, no longer stands, and Birmingham's row
   says "No prices yet." The same check holds out Simmons in Camden, read off
   the Shoreditch page. The fix is the hunt's alone: the map and those two
   venue sheets still show the wrong-branch figures until the data is
   corrected. That data fix for the wrong-branch sheets (The Botanist and
   Simmons in Camden) is queued as a separate task. Until it lands, no line in
   this kit quotes either venue's price.
8. **Rule 1 of [`BACKLINK_PLAYBOOK.md`](BACKLINK_PLAYBOOK.md)** says a pitch
   uses only a figure from `/press` or a dated Pint Index edition. F1 and F2 come
   from the front-door hunt card instead, which the captain's launch plan names
   as the press story (section 8, "a press pitch"). [CAPTAIN: decide. Either
   amend rule 1 to name the front-door hunt card, or hold the price pitch until
   `/press` carries these figures.]

---

## 1. Product Hunt

Copy the name and URL from
[`backlinks/listing.json`](backlinks/listing.json): name `PUBMAXX`, URL
`https://pubmaxxing.com`. Log the listing in
[`backlinks/ledger.csv`](backlinks/ledger.csv) as kind `listing` on the day it
goes up.

### Taglines (60 characters or fewer)

Counted in characters, spaces included, with a straight apostrophe.

| # | Tagline | Characters |
| --- | --- | --- |
| 1 | The hunt for the UK's cheapest pint, London first | 49 |
| 2 | London pub crawls planned on real, dated pint prices | 52 |
| 3 | Know the price of the pint before you get to the bar | 52 |

Pick 1 if the launch leads with the hunt (the launch plan's story). Pick 2 if
the gallery leads with the crawl. Pick 3 only if the thumbnail carries the
hunt.

### Description (245 characters)

> PUBMAXX shows what London pubs list for a pint, who listed it and the day we
> read it. Find the cheapest pint near you, plan a crawl and send one link to
> the group chat. Your mates open it without an account. Free for drinkers. No
> app to install.

Product Hunt's description box held 260 characters when this was written. Check
the limit on the day.

### Topics

In this order, taking as many as Product Hunt allows: Food & Drink, Maps,
Travel, Web App. [CAPTAIN: check the topic names on the day; Product Hunt
renames them.]

### Maker's first comment

Post it at 08:01 UK, the moment the page is live.

> Hello Product Hunt. I'm [CAPTAIN: your first name], and I built PUBMAXX in
> London.
>
> [CAPTAIN: one sentence on why you started, in your own words.]
>
> PUBMAXX does three things. It shows what London pubs list for a pint, with who
> listed it and the day we read the source. It hunts for the cheapest pint we
> can find in Britain, city by city, and says so plainly when a city has no
> prices yet. And it turns the pubs you pick into a crawl your mates open from
> one link, with no account and no app.
>
> Right now the cheapest pint we can find is £2.43 [F1], a pint of Bud Light at
> J.J. Moon's in Kingsbury, listed by Pint Prices, source read 2 October 2026.
> It's a tie: 19 London pubs on our list stand at £2.43 [F1], and the front page
> shows Kingsbury. London's dearest we hold is £9.50 [F2] for a pint of Aspall
> Cyder at Baccarat Bar on Brompton Road, also listed by Pint Prices, source
> read 2 October 2026. A source read is not a promise about tonight, so every
> price on the site says when we read it.
>
> It's a UK hunt, but London is where we go deep: 959 of the 2,033 pubs in our
> London pub list have a pint price on record [F3]. Leeds and Liverpool have a
> named cheapest pint. Manchester, Birmingham, Durham, Bath and Llandudno have
> no prices yet [F4]. If you drink there, you can log the first one.
>
> Nobody pays to rank. If a pub ever buys a slot, it says "Sponsored", sits in
> its own space, and can't change a price or a ranking. Drinkers pay for
> nothing.
>
> What I'd like from you today: [CAPTAIN: the one thing you want feedback on].
> And if we have your local's price wrong, log it in the app with the bill.

### The five questions hunters ask most, and the answers

**1. Where do the prices come from, and how fresh are they?**
From pubs' own websites and menus, from published price lists such as Pint
Prices, and from drinkers who log a price in the app. Every price names who
listed it and the day we read the source, and we never say a price is live.
A price can win the cheapest line only if it was seen at that pub: on the
price site's own page for the pub, or on the pub's own website. Some pubs show
an estimate instead. It is labelled an estimate, and an estimate
can never be called the cheapest.

**2. Is this only London?**
It's a UK hunt and London is deep. The hunt reads London and eleven other
cities on our map. Today Leeds and Liverpool have a named cheapest pint [F4],
four cities hold prices that don't say which pint, and five have no prices
yet. Each city says which of those it is. In London, 959 of the 2,033 pubs in
our London pub list have a pint price on record [F3].

**3. Do I need an account or an app?**
No. It runs in the phone browser, with no store app at launch. You can browse
prices, plan a crawl and send the link without signing in, and your mates open
the plan without an account. You sign in to log a price or to post.

**4. How do you make money? Will drinkers ever pay?**
Drinkers never pay. Not for prices, not for planning, and not for the Year in
Pints wrap, which is free forever. When there is revenue, it comes from pubs:
a free claimed page first, then paid slots that are always labelled
"Sponsored" and never change a price, a rank or a pin colour.

**5. Can a pub pay to rank, or can someone fake a price?**
A pub can't pay to rank. Paid content sits in its own labelled slot, and the
code keeps it apart from prices (`lib/sponsorship.ts`). A drinker who logs a
price can attach the bill. A typed price without one shows as "Logged by
@handle, not checked" with its date, and it can't colour a pin or win a
cheapest line until a second drinker agrees with it. And a listed figure under
£2.00 is held out, because it is a deal, a half or a typo, not a pint price.

---

## 2. Gallery and thumbnail

Five images, each at two widths: 390 by 844 (a phone) and 1440 by 900 (a
laptop). The images are not taken in this commit. The commands below were
written from the code at `bbd03ad6` (the hunt fix after it changed no screen)
and were not run, because the machine is
shared. [CAPTAIN or agent: take them on a quiet machine on 16 November, after
the figures are recomputed, and nudge a selector if the screen has moved.]

### Before the shots: one private-port production build

From [`e2e/AGENTS.md`](../../e2e/AGENTS.md): drive a private-port production
build with `npm run e2e:cli`, pass `--browser=chromium`, and give the full folder
in `--filename`. The artifacts folder is not committed.

```sh
# Build the launch head once, keyless, in its own folder.
NEXT_DIST_DIR=.next-prod PUBMAX_TRACKED_OUTPUTS=public/data \
  node scripts/run-with-restored-next-env.mjs npm run build

# Serve it on a private port. A plan needs a 32-byte signing secret.
NEXT_DIST_DIR=.next-prod PUBMAX_E2E_KEYLESS=1 \
  PLAN_IDEMPOTENCY_SECRET="$(openssl rand -base64 32)" \
  npm run start -- --port 3417
```

In a second shell, open one browser session and set the quiet state once. The
consent answer keeps the consent bar off the shots, and the tour and nudge keys
keep first-run cards away (the same keys `e2e/plan-invite.spec.ts` sets).

```sh
export PLAYWRIGHT_MCP_OUTPUT_DIR=artifacts/playwright-cli
npm run e2e:cli -- -s=ph open --browser=chromium
npm run e2e:cli -- -s=ph goto http://127.0.0.1:3417/
npm run e2e:cli -- -s=ph localstorage-set pubmaxx:analytics-consent:v1 denied
npm run e2e:cli -- -s=ph localstorage-set pubmax-tour-v1-done 1
npm run e2e:cli -- -s=ph localstorage-set pubmax_onboarding_dismissed 1
npm run e2e:cli -- -s=ph localstorage-set pubmax:identityNudge:dismissedAt:v1 "$(date +%s)000"
npm run e2e:cli -- -s=ph localstorage-set pubmax-theme light
```

With no stored theme the app is dark from 21:30 to 04:00 London time, so every
shot stores the theme it means.

### Shot 1. The hero card

- Route: `/`
- State: light theme. The card shows F1 with its pub, source and read day.
  Check it matches the recomputed F1 before you take it.

```sh
npm run e2e:cli -- -s=ph resize 390 844
npm run e2e:cli -- -s=ph goto http://127.0.0.1:3417/
npm run e2e:cli -- -s=ph run-code "async page => { await page.getByTestId('landing-hunt-card').waitFor(); }"
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-1-hero-390.png
npm run e2e:cli -- -s=ph resize 1440 900
npm run e2e:cli -- -s=ph reload
npm run e2e:cli -- -s=ph run-code "async page => { await page.getByTestId('landing-hunt-card').waitFor(); }"
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-1-hero-1440.png
```

### Shot 2. The map with price pills

- Route: `/map?area=piccadilly-soho` (Soho at zoom 14; pills show from zoom 12).
- State: light theme, the calm basemap. At 1440 the list sits beside the map.
- Wait for painted pins through the probe the browser suite uses
  (`window.__pubmaxPaintedMapTapPoints`). This box may draw the map in software,
  so the wait is long.

```sh
npm run e2e:cli -- -s=ph resize 390 844
npm run e2e:cli -- -s=ph goto "http://127.0.0.1:3417/map?area=piccadilly-soho"
npm run e2e:cli -- -s=ph run-code "async page => { await page.waitForFunction(() => (window.__pubmaxPaintedMapTapPoints?.() ?? []).length > 0, null, { timeout: 90000 }); await page.waitForTimeout(2000); }"
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-2-map-390.png
npm run e2e:cli -- -s=ph resize 1440 900
npm run e2e:cli -- -s=ph reload
npm run e2e:cli -- -s=ph run-code "async page => { await page.waitForFunction(() => (window.__pubmaxPaintedMapTapPoints?.() ?? []).length > 0, null, { timeout: 90000 }); await page.waitForTimeout(2000); }"
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-2-map-1440.png
```

### Shot 3. A plan link shared in a chat

- Route: `/plan`, then the locked plan `/plan/<id>`, then the guest's
  `/invite/<token>`.
- State: one plan made through the composer in this session, so the session
  holds the host's capability. "Quiet in Clapham for 4, not pricey" gave a
  priced three-stop route on a keyless build on 30 October 2026
  (`docs/SOFT_LAUNCH_RUNBOOK.md`, section 7). Make it before 18:00 London, or
  the default first pint can fall in the past and "Lock it in" stays off.
- The chat frame is a composite a designer builds from two real parts: the
  share text the "Send on WhatsApp" link carries, and the invite's own link
  preview image. Use a plain chat frame with no WhatsApp logo. Show only the
  sent message and its preview. No invented replies and no real person's name.
  [CAPTAIN: if you want replies in the frame, use a real beta chat, with
  written consent and names blurred.]

```sh
npm run e2e:cli -- -s=ph resize 390 844
npm run e2e:cli -- -s=ph goto http://127.0.0.1:3417/plan
npm run e2e:cli -- -s=ph run-code "async page => { await page.getByRole('textbox', { name: 'Where, how many, what budget' }).fill('Quiet in Clapham for 4, not pricey'); await page.getByRole('button', { name: 'Plan it', exact: true }).click(); await page.getByText('Route refreshed. Review the preview').waitFor({ timeout: 60000 }); await page.getByLabel('Your name').fill('[CAPTAIN: your first name]'); await page.getByRole('button', { name: 'Lock it in' }).click(); await page.waitForURL(/\/plan\/[0-9a-f-]{36}/); const exit = page.getByRole('button', { name: 'View full plan' }); if (await exit.isVisible()) await exit.click(); await page.getByRole('link', { name: 'Send on WhatsApp' }).scrollIntoViewIfNeeded(); }"
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-3-share-390.png
npm run e2e:cli -- -s=ph eval "document.querySelector('a[href*=\"wa.me\"]')?.href"
npm run e2e:cli -- -s=ph run-code "async page => { const id = page.url().match(/plan\/([0-9a-f-]{36})/)[1]; const state = await (await page.request.get('/api/plans/' + id)).json(); return { id, invite: '/invite/' + state.inviteToken, preview: '/invite/' + state.inviteToken + '/opengraph-image' }; }"
```

The `eval` prints the share link; its `text=` part is the message. The last
command prints the invite path and its preview image path. Then take the guest's
view and the preview image, using the paths it printed:

```sh
npm run e2e:cli -- -s=ph goto http://127.0.0.1:3417/invite/<token>
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-3-invite-390.png
npm run e2e:cli -- -s=ph resize 1440 900
npm run e2e:cli -- -s=ph reload
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-3-invite-1440.png
npm run e2e:cli -- -s=ph goto http://127.0.0.1:3417/invite/<token>/opengraph-image
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-3-preview.png
```

### Shot 4. Night mode

- Route: the same `/plan/<id>`, in the same session.
- State: dark theme. Night mode is a phone surface: it takes the whole screen
  at 640 pixels wide or less, while the plan's night is on, which is from three
  hours before the first pint. Take it after 16:00 London for a 19:00 plan.
  At 1440 the plan page shows the "It's on tonight" banner instead, so the
  1440 frame is the plan page in the dark theme with that banner, or the 390
  shot set on a dark 1440 canvas. Say which in the caption.

```sh
npm run e2e:cli -- -s=ph localstorage-set pubmax-theme dark
npm run e2e:cli -- -s=ph resize 390 844
npm run e2e:cli -- -s=ph goto http://127.0.0.1:3417/plan/<id>
npm run e2e:cli -- -s=ph run-code "async page => { const enter = page.getByRole('button', { name: 'Night mode', exact: true }); if (await enter.isVisible()) await enter.click(); await page.getByRole('dialog', { name: 'Night mode' }).waitFor({ timeout: 20000 }); }"
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-4-night-390.png
npm run e2e:cli -- -s=ph resize 1440 900
npm run e2e:cli -- -s=ph reload
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-4-night-1440.png
```

### Shot 5. The recap

- Route: `/plan/<id>/recap`, in the same session (a recap shows only to the
  crew).
- State: the night finished. Check in at each stop in night mode, then choose
  the ending. A recap for an unfinished night says "This night isn't finished
  yet", which is the wrong shot. Light theme.

```sh
npm run e2e:cli -- -s=ph resize 390 844
npm run e2e:cli -- -s=ph goto http://127.0.0.1:3417/plan/<id>
npm run e2e:cli -- -s=ph run-code "async page => { for (let stop = 0; stop < 3; stop++) { await page.getByRole('button', { name: /^We are here/ }).click(); await page.waitForTimeout(2000); } }"
npm run e2e:cli -- -s=ph snapshot --filename=artifacts/playwright-cli/ph-5-ending.yml
npm run e2e:cli -- -s=ph click <ref of the ending's confirm button, read from ph-5-ending.yml>
npm run e2e:cli -- -s=ph localstorage-set pubmax-theme light
npm run e2e:cli -- -s=ph goto http://127.0.0.1:3417/plan/<id>/recap
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-5-recap-390.png
npm run e2e:cli -- -s=ph resize 1440 900
npm run e2e:cli -- -s=ph reload
npm run e2e:cli -- -s=ph screenshot --filename=artifacts/playwright-cli/ph-5-recap-1440.png
npm run e2e:cli -- -s=ph close
```

### Gallery order and captions

Captions sit under each image. No joke beside a figure.

1. Hero card: "The cheapest pint we can find in Britain, with the pub, the
   source and the day we read it. J.J. Moon's, Kingsbury, is one of 19 London
   pubs at £2.43." [F1]
2. Map: "Prices on the map, in Soho and across London."
3. Chat: "One link to the group chat. Your mates open it without an account."
4. Night mode: "On the night: big buttons, one thumb, the next pub up top."
5. Recap: "The morning after, the night written down."

Export each frame at the size Product Hunt's upload screen asks for on the day.
Put the 390 shot inside a phone-width column on that canvas and the 1440 shot
full width.

### Thumbnail, with a price stamp

Square, at the size Product Hunt asks for (240 by 240 when this was written;
check on the day). Brand kit from [`POSTER_SPEC.md`](POSTER_SPEC.md): ink deep
`#060607` ground, the Crossing mark in its coral `#ff5a5f` chip, Space Grotesk
Bold.

- **Version A, the figure stamp.** A round stamp in the band colour the hero
  card gives F1 (`lib/priceBand.ts`), tilted a few degrees. Line 1, large:
  `£2.43` [F1]. Line 2, small, inside or under the stamp: `J.J. Moon's,
  Kingsbury. Pint Prices, read 2 Oct 2026.` [F1]. The tie (one of 19 London
  pubs) does not fit a thumbnail, so it goes in the first gallery caption. The mark chip in one corner.
- **Version B, the question stamp.** The same stamp reading `£?.??`, with no
  pub, no source and no date, because it claims nothing.

Ship A only if line 2 can be read at the size Product Hunt shows the thumbnail
in its feed. A price without its pub, source and date breaks the first rule of
this kit, so if line 2 cannot be read, ship B and let gallery image 1 carry the
figure.

---

## 3. The 45-second film

Screen recordings from a real phone on the launch head, in the light theme,
with reduced motion on. City shots show no identifiable person without a signed
release. Every figure on screen carries its pub, source and read day, held long
enough to read. Never say "live".

### Storyboard

| Seconds | Picture | On-screen text |
| --- | --- | --- |
| 0 to 3 | A London street at dusk, a pub sign, no faces. | What does a pint cost in London? |
| 3 to 9 | The phone opens `pubmaxxing.com`. The hero card fills the frame. | £2.43 [F1]. Bud Light at J.J. Moon's, Kingsbury. Listed by Pint Prices, source read 2 October 2026. One of 19 London pubs at this price. |
| 9 to 13 | Cut to the map pin for Baccarat Bar. Its sheet opens. | £9.50 [F2]. Baccarat Bar, Brompton Road. A pint of Aspall Cyder. Listed by Pint Prices, source read 2 October 2026. |
| 13 to 18 | The map over Soho, price pills, a slow pan. A tap on a pill opens a sheet with its price and date. | Every price says who listed it and when. |
| 18 to 25 | `/plan`: type "Quiet in Clapham for 4, not pricey", tap "Plan it", the priced route appears, tap "Lock it in". | Plan a crawl in a sentence. |
| 25 to 31 | Tap "Send on WhatsApp". The chat frame from gallery shot 3, the link preview landing. | One link. No account for your mates. |
| 31 to 37 | Night mode in the dark: "We are here", the next pub up top. | On the night, one thumb. |
| 37 to 41 | The recap scrolls past. | The morning after, written down. |
| 41 to 45 | End card: the Crossing mark, `pubmaxxing.com`. | Free for drinkers. Prices never for sale. |

### Voice-over

Read at a calm pace, about 105 words. If it runs long, cut "Every price says
who listed it and when", because the screen already says it.

> What does a pint cost in London?
>
> The cheapest we can find in Britain right now is two pounds forty-three, for
> a Bud Light at J.J. Moon's in Kingsbury. Nineteen London pubs tie at that
> price. Pint Prices listed it. We read it on the second of October. [F1]
>
> The dearest we hold in London is nine pounds fifty, for a pint of cider at
> Baccarat Bar on Brompton Road. Same source, same day. [F2]
>
> Every price says who listed it and when.
>
> Plan the crawl in a sentence. Send one link. Your mates don't need an account.
>
> On the night, one thumb. The morning after, it's written down.
>
> PUBMAXX. Free for drinkers. Prices are never for sale.

---

## 4. Press

Send the release under embargo on Monday 16 November, after the figures are
recomputed, with the embargo lifting at 08:01 UK on Tuesday 17 November. Log
each pitch in [`backlinks/ledger.csv`](backlinks/ledger.csv) as kind
`journalist`, status `pitched`, before you send it
([`BACKLINK_PLAYBOOK.md`](BACKLINK_PLAYBOOK.md), rule 4). Read risks 1, 3 and
8 in section 0 first. Read risk 2 as well: F1 is a tie.

### Press release

> **EMBARGOED UNTIL 08:01 GMT, TUESDAY 17 NOVEMBER 2026**
>
> **London's cheapest and dearest pint, with who listed each price and when**
>
> *PUBMAXX, a London pub-crawl planner that shows listed pint prices with who
> listed them and when, launches on Product Hunt today.*
>
> LONDON, 17 November 2026. The cheapest pint PUBMAXX can find in Britain is
> £2.43 [F1], for a pint of Bud Light at J.J. Moon's, a Wetherspoon at 553
> Kingsbury Road, Kingsbury, in Brent. Pint Prices listed it on its page for
> that pub, and PUBMAXX read that source on 2 October 2026. It is a tie: 19
> pubs in PUBMAXX's London pub list stand at £2.43 [F1], and the site shows J.J.
> Moon's, Kingsbury, by a fixed tie-break.
>
> The dearest pint in London that PUBMAXX holds is £9.50 [F2], for a pint of
> Aspall Cyder at Baccarat Bar, 87-135 Brompton Road. That is the venue in its
> London pub list where even the cheapest pint costs the most. Pint Prices
> listed it, and PUBMAXX read that source on 2 October 2026.
>
> Across London, 959 of the 2,033 pubs in PUBMAXX's London pub list have a
> pint price on record [F3].
>
> PUBMAXX calls this the hunt for the UK's cheapest drink. It is a UK hunt, but
> London is where the data goes deep. Outside London, the hunt names a cheapest
> pint in Leeds (£3.80 at The Chemic Tavern, listed by the pub's own website,
> read 4 September 2026) and Liverpool (£3.70 at Shenanigans, listed by the
> pub's own website, read 4 September 2026) [F4]. Oxford, Glasgow, Bristol and
> Cambridge hold prices that do not say which pint. Manchester, Birmingham,
> Durham, Bath and Llandudno have no prices yet, and the site says so [F4].
>
> "[CAPTAIN: a quote in your own words. Do not let anyone write it for you.]"
> said [CAPTAIN: your name and role, as you want them printed].
>
> PUBMAXX runs in a phone's browser with no app to install. A visitor can find
> the cheapest listed pint near them, plan a crawl in a sentence, and send one
> link that their friends open without an account. Drinkers pay for nothing.
> Pubs can claim their page for free. Any paid placement will be labelled
> "Sponsored" and can never change a price or a ranking.
>
> **Notes to editors**
>
> 1. What can win. Only a listed or confirmed price can be called the cheapest
>    or the dearest: a price published by a named source, with the day PUBMAXX
>    read it, and seen at that pub, on the price site's own page for it or on
>    the pub's own website. Estimates are labelled as estimates and never win. A figure under
>    £2.00 or over £12.00 is not read as a pint price. A bar the public cannot
>    walk into, such as a students' union bar, is left out. The source's own
>    words must name the drink, or state that it is a pint.
> 2. What "read" means. The date is the day PUBMAXX read the source, not the day
>    the pub set the price. A pub may have changed its price since.
> 3. London's dearest is a venue's cheapest pint, the dearest PUBMAXX holds, so
>    a cocktail or a bottle can never take the title.
> 4. Where the hunt looks. London and the eleven other cities on the PUBMAXX
>    map. A cheaper pint may exist somewhere PUBMAXX has not read.
> 5. Links. The hunt is on the front page, `https://pubmaxxing.com`. Each pub
>    opens on the map: J.J. Moon's, Kingsbury, at
>    `https://pubmaxxing.com/map?sel=venue-cbqtvi` [F1], Baccarat Bar at
>    `https://pubmaxxing.com/map?sel=venue-3pjert` [F2]. Findings and method
>    for journalists are at `https://pubmaxxing.com/press`.
> 6. About PUBMAXX. [CAPTAIN: two sentences on who runs it and since when.]
> 7. Press contact. [CAPTAIN: the press address. The `pressEmail` field in
>    `docs/growth/backlinks/listing.json` is the one directory listings carry.]
>
> ENDS

### Pitch notes, angle only

No contact details here. [CAPTAIN: find the right desk at each outlet and log
the pitch first.]

- **Evening Standard.** The money story: a pint is £2.43 at J.J. Moon's in
  Kingsbury, one of 19 London pubs at that price, and £9.50 at Baccarat Bar on
  Brompton Road, both listed by Pint Prices and read 2 October 2026 [F1, F2]. The cost of a night out, told with
  figures a reader can open and check.
  Offer the method (notes to editors 1 to 3) up front, because a news desk will
  ask how "cheapest" is decided.
- **Time Out.** The night out: the hunt as a game, the "Cheapest Soho crawl" on
  Thursday 19 November at 7pm that anyone can ask to join (section 5), pint
  roulette on `/near` (one random pub with a listed pint under your price,
  within a 15-minute walk), and the £20 crawl (type "a £20 crawl" and the
  planner reads it as £20 a head). Lead with what a reader can do this week.
- **Secret London.** The odd corners: the pint price time machine
  (`/time-machine`, what a pint cost at London pubs in a year you pick, from
  dated reviews), Dog of the week (`/dog-of-the-week`, the newest dog met at a
  London pub, from the photo wall), and "cheapest anything" on `/near`
  (Guinness, house wine, Coke, coffee and alcohol-free). Light, shareable, and
  every figure still dated.
- **MyLondon.** The borough story: what a pint costs in the reader's own
  borough. The pub the front page shows for the cheapest we can find is in
  Brent (J.J. Moon's, Kingsbury, one of 19 London pubs at £2.43), and the
  dearest we hold is in Kensington and Chelsea (Baccarat Bar) [F1, F2]. Each borough has its own page
  (`/borough/<slug>`). Invite readers to log their local's price with the bill.

---

## 5. Community

### r/london post (draft)

**[CAPTAIN: before posting, read r/london's current rules on self-promotion and
on links, and follow them. If they do not allow this post, do not post it, and
do not post it somewhere it does not belong.]** Post from your own account and
say plainly that you made it. Reply to every question for the first two hours.

> **Title:** I made a map of what London pubs list for a pint, with who listed
> each price and when
>
> I'm [CAPTAIN: first name], and I built this, so take it as a maker's post.
>
> It's a pub map for London that shows what each pub lists for a pint, who
> listed it (the pub's own site, a published price list, or a drinker with the
> bill) and the day the source was read. You can plan a crawl and send your
> mates one link that works without an account.
>
> The cheapest pint I can find in Britain right now is £2.43 for a Bud Light at
> J.J. Moon's in Kingsbury, listed by Pint Prices, read 2 October 2026 [F1].
> It's a tie: 19 London pubs on my list are at £2.43 [F1]. The dearest in
> London that I hold is £9.50 for a pint of Aspall Cyder at Baccarat Bar on
> Brompton Road, same source, same day [F2]. Prices move, which is why each one
> carries its date.
>
> 959 of the 2,033 pubs in our London pub list have a pint price on record
> [F3].
> The rest don't yet. If your local is wrong or missing, you can log its price,
> and a price with the bill counts for more than one without.
>
> It's free and there's no app to install. I'd like to know which pubs you think
> are wrong. [CAPTAIN: the link, only if the rules allow one.]

### Street videos

The three "What does a pint cost here?" scripts are template 11 in
[`CONTENT_TEMPLATES.md`](CONTENT_TEMPLATES.md). Use the recomputed figures.

### University societies

For a society's committee or social secretary. Send it to a society you have a
real link with, or that runs nights out. [CAPTAIN: which societies, and through
whom.]

> Hi [society name] committee,
>
> I'm [CAPTAIN: first name]. I built PUBMAXX, a free London pub map that shows
> what each pub lists for a pint, with who listed it and when.
>
> It might help with socials. Describe the night in one line (where, how many,
> what budget) and it plans a crawl with the listed price at each pub. Then
> send one link to the group chat, and people open it without an account. It
> also finds the cheapest Coke, coffee and alcohol-free near you, so nobody is
> left out of the round.
>
> One honest note: students' union bars aren't in our hunt for the cheapest
> pint, because the public can't walk in. Your union bar may well beat every
> pub on the map.
>
> It's free for drinkers, and that won't change. If you try it for a social,
> I'd like to hear what was missing.
>
> [CAPTAIN: your name and how to reach you]

### Pub quiz teams

For a team captain or a quiz night's group chat.

> Quiz team,
>
> PUBMAXX is a free London pub map. The Tonight tab lists quiz nights from
> sourced listings, with the start time when the source gives one. Where we
> hold a pub's pint price, it shows who listed it and when.
>
> So you can find a quiz, see what the round will cost before you get there, and
> send the team one link. Nobody needs an account to open it.
>
> If your quiz pub's price is wrong or missing, log it with the bill and the next
> team sees it.
>
> [CAPTAIN: your name. Add the link where the chat allows it.]

### Hosted public crawl: "Cheapest Soho crawl, Thursday 7pm"

Thursday 19 November 2026, 19:00. Built on the open-crawl rules in
`lib/openCrawl.ts`:

1. Make the plan in the planner, or use "Host this on a date" from a fixed route
   on `/crawls` (today to 60 days ahead, 19:00 by default). Pick three Soho pubs
   by their listed pint prices on the map. **Call it "Cheapest" only if every
   stop carries a listed price, not an estimate.** Otherwise call it "Cheap Soho
   crawl".
2. Lock it, then "Open it up". Pick a crew size from 4 to 20; 8 is the default.
   The meeting pub must be one of the plan's own stops; Stop 1 is offered first.
3. The host's one line: 140 characters at most, no links, no phone numbers, no
   email addresses, no handles, and none of the words that sell quantity
   (`sesh`, `session`, `wasted`, `smashed`, `hammered`, `carnage`, `blackout`,
   `bottomless`). This line passes the checker as written (118 characters):

   > Cheapest Soho crawl: three pubs, listed prices on the plan. Meet at stop
   > one. Buy your own round, leave when you like.

4. The crawl moves to a crew page anyone can find. The old invite link stops
   working. People ask to join there, and the host says yes or no. It shows in
   "Crawls you can join this week" on `/crawls` from seven days before.
5. The host needs to be signed in, with a handle people can see.
6. [CAPTAIN: open crawls need migration 0208 on production. The launch plan
   listed 0203 to 0216 as not applied on 1 November. Check before you post.]

The post that sends people to it (social, societies, quiz chats):

> Cheapest Soho crawl. Thursday 19 November, 7pm.
>
> Three Soho pubs, picked by their listed pint prices: [CAPTAIN: the three pubs,
> each with its listed price, who listed it and the read day, copied from the
> plan page on the day]. We meet at [CAPTAIN: Stop 1].
>
> Eight places. Ask to join on PUBMAXX and I'll say yes while there's room. Buy
> your own round, alcohol-free counts, leave when you like.
>
> [CAPTAIN: the crew page link]

---

## 6. Pubs

Poster and beer-mat copy for the launch is in [`POSTER_SPEC.md`](POSTER_SPEC.md),
section "Launch variant, November 2026". No price is ever printed on paper.

### The free claimed page (launch plan, section 7)

For a landlord or manager, said in person or sent after a visit. Target: 30
claimed pubs in Soho, Shoreditch and Hackney, and Clapham before launch, 100 by
Christmas (launch plan, section 10).

> Hello [pub name],
>
> I'm [CAPTAIN: first name] from PUBMAXX, a free London pub map. Your pub is
> already on it. Where we hold your pint price, it shows who listed it and the
> day we read it.
>
> You can claim the page for free:
>
> - Open your pub on `pubmaxxing.com`, sign in, and tap "Run this pub?".
> - Tell us how we can check it's you: an email at your pub's own web address,
>   the pub's phone, or a document. We check by hand.
> - Once you're checked, you can send us a correction, an event, an offer or a
>   reply. We read each one before it goes up, and an accepted one shows as
>   "From the pub" on your page and on Tonight.
> - Crews can ask you for a table, and the request comes to you. That is free.
>
> What you can't buy: a better price, a higher place in a list, or a different
> pin colour. Prices come from what's listed or logged, never from who pays.
>
> Later, there may be paid slots. Each one will say "Sponsored", sit in its own
> space, and never change a price, a rank or a pin. We won't offer any until 30
> pubs have claimed their pages.
>
> We'd also like three photos of the pub. [CAPTAIN: say how a pub sends them
> today. The claim form does not take photos yet.] And if you'd like a poster
> and beer mats for the bar, we'll bring them.
>
> [CAPTAIN: your name and how to reach you]

Notes for the captain:

- "Ask for a table" emails the request to a checked operator once the Resend
  keys are set in production. [CAPTAIN: confirm before you promise email.]
- "From the pub" and "Ask for a table" need migrations 0217 and 0219 on
  production. [CAPTAIN: check the migration ledger before the first visit.]
- The paid-slot rules are [`docs/SPONSORSHIP_POLICY.md`](../SPONSORSHIP_POLICY.md):
  the label is exactly "Sponsored", the slot is isolated, and payment never
  changes ranking, eligibility, warnings, provenance, alternatives or prices.
- First revenue comes from venues, never drinkers. Do not quote a price for a
  slot before the venue rail exists ([ADR 0011](../adr/0011-venue-operator-rail.md)).

---

## 7. Seasonal hooks

Neither feature is in this checkout on 1 November 2026. Another agent is
building both this week. Until they ship, every line below says "coming".
[CAPTAIN: check each is live on production before you drop the word "coming".]

- **Christmas crawl (coming).** "Christmas crawl, coming: the work do, planned
  around listed prices, with one link for the whole office."
- **Dry January, the Dry round (coming).** "The Dry round, coming for Dry
  January. The round still gets bought, alcohol-free." The cheapest
  alcohol-free drink near you is already on `/near` today, so that half may be
  said without "coming".

---

## 8. Launch-day schedule, Tuesday 17 November 2026

All times UK (GMT). Product Hunt's day runs from 00:01 to 23:59 Pacific, which
is 08:01 on Tuesday to 07:59 on Wednesday UK time.

### The day before, Monday 16 November

| Time | What | Who |
| --- | --- | --- |
| Morning | Freeze, launch-head sweep and smoke walk on production (launch plan, section 8). | Captain, agents |
| After the release | `npm run launch:figures` on the launch head. Replace every changed `[F]` figure. Check the front door shows the same F1. | Agent, captain checks |
| 12:00 | Check F1 at the bar or in the Wetherspoon app (section 0, risk 1). | Captain |
| 13:00 | Gallery shots 1 to 3 (shot 3 must be made before 18:00). | Captain or agent |
| 14:00 | Send the embargoed release and the four pitch notes. Log each in the ledger first. | Captain |
| 16:00 to 18:00 | Gallery shots 4 and 5 (night mode needs the plan's night on). Upload the gallery, thumbnail, taglines and description, and schedule the post. | Captain |

### Launch day

| Time | What | Who |
| --- | --- | --- |
| 07:30 | `/api/version` names the launch head. `/api/health` answers. The hero card on `pubmaxxing.com` matches F1. | Captain |
| 08:01 | Product Hunt goes live. Post the maker's first comment at once. The press embargo lifts. | Captain |
| 08:10 | WhatsApp the beta crews: the Product Hunt link and one line asking them to look. Do not ask for upvotes. | Captain |
| 08:30 | [CAPTAIN: your own channels, for example X and LinkedIn.] | Captain |
| 09:00 | Check posters and beer mats are up in the claimed pubs. | Captain |
| 10:00 | University societies message. | Captain |
| 11:00 | r/london post, only if its rules allow it. Reply for two hours. | Captain |
| 12:00 | Street video 1 (template 11, script A). | Captain |
| 12:30 | Product Hunt replies and the day's first numbers. | Captain |
| 13:00 | Pub quiz teams message. | Captain |
| 14:00 | Health round: PostHog shows `plan_invite_sent`, `plan_accepted`, `crew_committed` with `environment = production`; no new `$exception` spike; Supabase usage under the free plan's limits. If the spike is large, upgrade the database plan (launch plan, R1). | Captain, agent |
| 15:00 | Pub visits for claimed pages (section 6). | Captain |
| 17:30 | Street video 2 (script B). | Captain |
| 18:00 | Post the "Cheapest Soho crawl" invite for Thursday 19 November. | Captain |
| 19:00 | Product Hunt replies. Second health round. | Captain |
| 20:30 | Street video 3 (script C). | Captain |
| 22:00 | Last health round. The nightly off-platform backup runs (launch plan, R1). | Captain |
| Wed 07:59 | Product Hunt's day closes. Post one thank-you comment with what changed because of the feedback. | Captain |

Through the day, answer every Product Hunt comment within the hour, and answer
a price question with the price, the pub, who listed it and the read day.
