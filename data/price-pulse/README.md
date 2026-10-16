# Price Pulse editions

One file is one weekly edition of `/price-pulse`: `data/price-pulse/<YYYY-MM-DD>.json`.
`lib/pricePulse.ts` owns the shape and the parser. `lib/pricePulseEditions.ts` registers
each file. The page shows an edition only when `approved` is `true` and `approvedAt` is set.

## The law

A Price Pulse figure is a claim. It is never a price.

- It never paints a map pin, enters a Price Lane, or counts as a Pint Drop.
- An item has no number field. Each figure stays inside the item's prose.
- A Social Post has no price authority (`CONTEXT.md`). A retold post has less.

`__tests__/pricePulse.test.tsx` holds these rules. Do not weaken that test to make a
draft pass. Change the draft.

## Weekly runbook for a research agent

Do these steps in this order.

1. Start the draft. Use the Friday of the edition week:

   ```sh
   npm run price-pulse:draft -- --edition 2026-10-23
   ```

   The script writes the file with `approved: false` and registers it. The window ends
   the day before the edition and starts 30 days before that. Use `--window-start` and
   `--window-end` to change it.

2. Do the research. Read only public pages. Do not log in, do not use cookies, and do
   not use an API that needs an agreement. The `/last30days` skill and a web search are
   enough. Do not fetch a page through the harvest lanes.

3. Write each item in our own words. Each item needs:
   - `id`: a lower-case slug, unique in the edition.
   - `kind`: `drinkers` (Reddit, forums, comments), `trade` (BBPA, SIBA, CAMRA) or
     `press`.
   - `said`: one or two plain sentences. Say who said it and the figure they gave.
   - `source.label`: where it was said, for example `r/london` or `Metro`.
   - `source.url`: the `https://` link to the post or article.
   - `source.publishedOn`: the day it was posted or published, `YYYY-MM-DD`.

4. Keep to these rules:
   - Never write a username, a handle or a "posted by" line. Write "a drinker" or
     "a reply in the same thread".
   - A `quote` is optional and short: 15 words or less, and always attributed.
     Never copy more of a post.
   - Use neutral words about a venue. Report the figure. Do not judge it. The parser
     refuses words such as "rip-off" and "scam".
   - Keep a figure exactly as the source gives it. Do not round it or convert it.
   - British spelling. No em dash. No exclamation mark (`docs/VOICE.md`).

5. Link a pub on our map, if there is one. Find the pub's `venue-…` id in
   `public/data/venues_slim.json` and set `venueId`. If PUBMAXX holds a Confirmed price
   for that pub, the page shows it beside the claim with its own date. Every other line
   shows "Not checked by PUBMAXX". Never write a PUBMAXX price into the file.

6. Write `title` and `summary` last, from the items.

7. Check the draft:

   ```sh
   npx vitest run __tests__/pricePulse.test.tsx
   ```

   The test names each field that is wrong. Fix the draft until the test passes.

8. Open a pull request with the draft. Leave `approved: false` and `approvedAt: null`.

## Approval

Only the owner approves an edition. To approve it, set `"approved": true` and set
`"approvedAt"` to the ISO time of the approval, for example
`"2026-10-23T09:00:00.000Z"`. An agent never does this step.

## The "Where your £6 goes" explainer

The explainer is not an edition. Its rates, sources and views are in
`lib/pricePulseExplainer.ts`. Update a rate on the day it changes, with its GOV.UK
source and date, and update `EXPLAINER_REVIEWED_ON`. Never add a figure for what one
pub keeps.
