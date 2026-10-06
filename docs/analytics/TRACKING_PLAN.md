# PUBMAXX tracking plan

Owner: captain. Source of truth for the event names and props: `lib/analyticsEvents.ts`.
This file says what each event ANSWERS. It never restates a prop list the registry
already owns, and `__tests__/analyticsTrackingPlan.test.ts` fails the build when the
registry grows an event this file does not name.

Issue: [#1361](https://github.com/Singularityszn/pubmax/issues/1361).

## 1. How an event reaches PostHog

Two reader transports, one consent gate, plus server telemetry that no reader is behind.

| Transport | Carries | Path |
|---|---|---|
| Named product events | The closed registry in `lib/analyticsEvents.ts` | `trackEvent()` (`lib/analytics.ts`) to `POST /api/events`, re-validated there, then `lib/posthogServer.ts` to the EU capture endpoint |
| Browser SDK events | `$pageview`, `$web_vitals`, redacted `$exception` | `posthog-js` (`lib/posthogClient.ts`) through the first-party `/ingest` proxy (`app/ingest/[...path]/route.ts`) |
| Server telemetry | `$ai_generation` per direct model call, redacted server `$exception` | `capturePosthogServerEvent` (`lib/posthogServer.ts`) under a fixed server `distinct_id` with no person profile, so it is never a reader and never enters a reader rate |

Four facts that decide how every query below is written.

1. **Consent gates both.** `trackEvent()` no-ops without explicit analytics consent,
   and `/api/events` re-checks consent plus the pseudonymous id before it forwards
   anything. Every rate in this plan is a rate over CONSENTED visitors. It is not a
   rate over all traffic, and it may never be reported as one.
2. **Named events carry no `$session_id`.** `capturePosthogEvent` sends the event
   name, its props, `path`, and `distinct_id`. Session-scoped funnels therefore do
   not work on named events. Time-window funnels on `distinct_id` do.
3. **A named event's page is `path`, not `$pathname`.** A browser SDK event uses
   `$pathname` from the closed vocabulary in `lib/analyticsPath.ts`. A query that
   mixes the two transports must read the right property for each step.
4. **No account identity ever joins the analytics id.** ADR 0009. A query that needs
   a person is the wrong query.
5. **Every event names its lane and its build.** Both transports stamp `environment`
   (`production`, `preview`, `development`, `internal-test`), `release` (the short
   commit) and `schema_version`, from `lib/analyticsAttribution.mjs`. A product figure
   filters `properties.environment = 'production'`, never `$host`: a named event is
   sent from the server and carries no host at all. A row with no `schema_version` is
   version 1 and is unattributed, so it may not be read as production.

What each NUMBER means, and what it is divided by, lives in
`docs/analytics/METRICS.md`: the north star and every supporting measure with its own
denominator rule. This file stays the map of the EVENTS.

## 2. The release metric: first meaningful action within 60 seconds

Captain's release metric, 4 September 2026.

**Landing.** `discovery_viewed` with `surface = 'landing'`. Its only emitter is
`components/landing/LandingPage.tsx`, once per landing mount. It rides the same
transport as the actions below, which is why it is the denominator instead of the
`$pageview` on `/`. A landing whose SDK never loaded still counts on both sides.

**First meaningful action.** The earliest `landing_cta_clicked` or `price_submitted`
by the same `distinct_id` after that landing. Those two are the captain's set: the
front door's own tap, and the price receipt the whole product is built around.

**The metric.** The share of landings whose first meaningful action arrives 60
seconds or less after the landing.

### 2.1 The exact query (authoritative)

HogQL. Run it through `POST /api/projects/:project_id/query/` with
`{"query": {"kind": "HogQLQuery", "query": "<the SQL below>"}}`.

```sql
WITH landings AS (
    SELECT distinct_id, timestamp AS landed_at
    FROM events
    WHERE event = 'discovery_viewed'
      AND properties.surface = 'landing'
      AND timestamp >= now() - INTERVAL 7 DAY
),
actions AS (
    SELECT distinct_id, timestamp AS acted_at
    FROM events
    WHERE event IN ('landing_cta_clicked', 'price_submitted')
      AND timestamp >= now() - INTERVAL 7 DAY
),
paired AS (
    SELECT
        landings.distinct_id AS distinct_id,
        landings.landed_at AS landed_at,
        min(if(actions.acted_at > landings.landed_at,
               dateDiff('second', landings.landed_at, actions.acted_at),
               NULL)) AS first_action_seconds
    FROM landings
    LEFT JOIN actions ON actions.distinct_id = landings.distinct_id
    GROUP BY landings.distinct_id, landings.landed_at
)
SELECT
    count() AS landings,
    countIf(first_action_seconds <= 60) AS acted_within_60s,
    round(100.0 * countIf(first_action_seconds <= 60) / count(), 1) AS rate_pct,
    median(first_action_seconds) AS median_seconds_to_first_action
FROM paired
```

Three properties of that query, stated so nobody has to rediscover them.

- **`first_action_seconds` is null when no action followed.** `min` ignores nulls, and
  `countIf(null <= 60)` is false, so a landing with no action counts in the
  denominator and not in the numerator. That is the intended reading.
- **A repeat landing gets its own row.** Each landing is paired with the earliest
  action after ITSELF. A visitor who lands twice contributes two landings.
- **Seven days is the release window.** Change `INTERVAL 7 DAY` in both CTEs together,
  or the join loses actions the landings still expect.

### 2.2 The same metric as a dashboard funnel

The HogQL above is the number to quote. The funnel tile is for reading the shape.

A PostHog funnel step is one event, so step 2 needs an **action** that matches both
event names. Create it once:

```bash
curl -sS -X POST "$POSTHOG_HOST/api/projects/$PROJECT_ID/actions/" \
  -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
  -H "content-type: application/json" \
  -d '{"name":"First meaningful action",
       "description":"Landing CTA tap or a logged price. docs/analytics/TRACKING_PLAN.md 2.",
       "steps":[{"event":"landing_cta_clicked"},{"event":"price_submitted"}]}'
```

The funnel is then `discovery_viewed` (`surface = landing`) to that action, with the
conversion window set to **60 seconds**. `docs/analytics/weekly-dashboard.json` carries
it as tile 2 and names the action by the id the call above returns.

## 3. The weekly view

`docs/analytics/weekly-dashboard.json` is the machine definition. Six numbers, in
seven insights: tile 2 ships its funnel companion beside the figure it answers with.

| # | Tile | Reads |
|---|---|---|
| 1 | Weekly active visitors | Unique `distinct_id` over all events, weekly |
| 2 | First action within 60 seconds | The HogQL in 2.1, plus the funnel in 2.2 |
| 3 | Landing to Map to venue sheet | `discovery_viewed` (landing), `$pageview` (`/map`), `venue_sheet_opened` |
| 4 | Pint Drop submissions and corroboration | `price_submitted`, `price_submit_outcome`, `price_submit_failed` |
| 5 | Top routes by LCP | `web_vital` where `metric = LCP`, p75 of `value`, broken down by `route` |
| 6 | The four loop moments (5.10) | `late_food_viewed` / `late_food_added`, `briefing_viewed` / `briefing_opened`, `voice_started`, `recap_viewed` |

Two honest limits on that table.

- **Tile 3 crosses both transports.** Its middle step is a browser SDK `$pageview`,
  because no named event marks arriving on the Map. A visitor whose SDK is blocked
  drops out at step 2 while still reaching step 3. Read step 1 to step 3 as the
  reliable pair, and step 2 as the shape of the walk between them.
- **Tile 6 reads as pairs, not as totals.** Each series is one half of a ratio
  (5.10). A rise in `late_food_viewed` with a flat `late_food_added` is the
  finding; either line alone says nothing, because both move with how many
  nights reached their last stop at all.
- **Tile 4 does not say "confirmed".** A `PintDropConfirmation` is minted on the
  server (`lib/pintDropConfirm.server.ts`), by a second reporter or by a moderator.
  Neither has a consenting browser we may speak for, so it may not become a PostHog
  event under ADR 0009. `price_submit_outcome` with `outcome = 'trusted'` is the
  nearest honest signal: the submitter's own tap corroborated the figure, so the map
  may paint it. The durable confirmation count stays where it already lives, in
  `GET /api/freshness` (`communityPrices.corroboratedCategories`) and the Pint Index
  snapshot.

### 3.1 Creating the dashboard

The Vercel project `chengdu` (team `pubmax69`) holds
`NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` and nothing else.
That token is a write-only ingest key. It cannot create a dashboard.

So the dashboard ships as JSON, and the captain runs these calls once with a
**personal API key** (PostHog, Settings, Personal API keys, scopes `dashboard:write`,
`insight:write`, `action:write`, `project:read`).

```bash
export POSTHOG_HOST=https://eu.posthog.com
export POSTHOG_PERSONAL_API_KEY=phx_...        # never commit this
# 1. Find the project id.
curl -sS "$POSTHOG_HOST/api/projects/" \
  -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY"
export PROJECT_ID=...
# 2. Create the action from 2.2 and keep the id it returns.
# 3. Create the dashboard.
curl -sS -X POST "$POSTHOG_HOST/api/projects/$PROJECT_ID/dashboards/" \
  -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
  -H "content-type: application/json" \
  -d '{"name":"PUBMAXX weekly","description":"docs/analytics/TRACKING_PLAN.md"}'
export DASHBOARD_ID=...
# 4. Create each tile. One call per entry in the JSON file's "insights" array.
python3 - <<'PY'
import json, os, urllib.request
spec = json.load(open("docs/analytics/weekly-dashboard.json"))
host, project = os.environ["POSTHOG_HOST"], os.environ["PROJECT_ID"]
key, dashboard = os.environ["POSTHOG_PERSONAL_API_KEY"], int(os.environ["DASHBOARD_ID"])
for insight in spec["insights"]:
    body = json.dumps({**insight, "dashboards": [dashboard]}).encode()
    request = urllib.request.Request(
        f"{host}/api/projects/{project}/insights/", data=body, method="POST",
        headers={"Authorization": f"Bearer {key}", "content-type": "application/json"})
    print(insight["name"], urllib.request.urlopen(request).status)
PY
```

Tile 2's funnel carries `"__action_id_placeholder"`. Replace it with the id from
step 2 before running step 4.

## 4. Who acts

Read the dashboard once a week. Each number has one owner and one action.

| Number | Healthy | When it is not | Owner acts |
|---|---|---|---|
| First action within 60 seconds | Rising week on week | Falls two weeks running | Captain: the front door is asking for the wrong first tap. Re-cut the landing primary action (`LANDING_PRIMARY_HREF`, `components/landing/LandingPage.tsx`) and re-read the tile the week after. |
| Landing to venue sheet (tile 3, step 1 to step 3) | Rising | Falls while tile 2 holds | Map owner: the tap lands and the walk to a pub dies. Read `map_search_no_results` and the Map surface trail before touching the landing. |
| Pint Drop submissions per week | Rising | Flat while venue sheets rise | Price owner: drinkers reach pubs and do not log. Read `price_submit_viewed` against `price_submitted`, then `price_submit_failed` by reason. |
| `price_submit_outcome` trusted share | Rising | Flat or falling while submissions rise | Price owner: prices land and never corroborate, so the map stays grey. Point price evidence missions at the pubs holding one voice. |
| `price_submit_failed` where `reason = 'rejected'` | Near zero | Any sustained rise | Engineer on call: `/api/price-submit` is refusing real drinkers. Read the route logs the same day. |
| Weekly active visitors | Rising | Falls while tile 2 holds | Captain: the product converts and nobody arrives. This is an acquisition finding, never a product one. |
| LCP p75 per route | Under the route's ceiling in `perf/route-budgets.json` | Any route over its ceiling | Engineer on call: open the route budget, not the dashboard. `docs/PERFORMANCE_BUDGETS.md` owns the remedy. |
| `late_food_added` against `late_food_viewed` | Rising share | Falls while `late_food_viewed` rises | Captain: the night asks for food and the shortlist is not worth taking. Read `late_food_added` by `confidence` before widening the evidence lane. |
| `briefing_opened` against pushes sent | Rising | Near zero while briefs are sent | Captain: the brief is delivered and nobody opens it. It is a copy and timing question, never a bug in the surface. |
| `contribution_gate` where `step = 'sign_in_required'` | Low against `price_submit_viewed` | Rising share | Captain: the identity door is the cost of a price. It is a product decision, not a bug. |

None of these numbers may be read as a person. There is no account identity in the
analytics rail, so no row above names a drinker, and none of them may be turned into
one by joining anything to `distinct_id`.

## 5. The event catalogue

Every name in `lib/analyticsEvents.ts`. The registry owns the props and their closed
vocabularies. The column here is the question the event exists to answer.

### 5.1 Acquisition and arrival

| Event | Answers |
|---|---|
| `discovery_viewed` | How many landings happened, and at what time of day. The release metric's denominator. |
| `landing_cta_clicked` | Which front door a visitor took. |
| `poster_landing` | A physical QR poster sent somebody to `/near`. |
| `poster_shared` | A poster or card was shared out of a surface. |
| `pint_index_viewed` | A press arrival on the live Index or a dated edition, and whether the browser had been before. |
| `pint_index_area_opened` | The arrival tapped through to an area. |
| `pint_index_map_reached` | The Map really loaded from that tap, so an abandoned navigation cannot inflate reach. |
| `add_link_viewed` | A share link at the table was opened. |
| `add_link_signup_started` | That link sent somebody to make an account. |
| `add_link_added` | The follow landed. |
| `creator_list_viewed` | A public creator list reached a reader. |
| `creator_list_map_opened` | That list handed the reader to the Map. |
| `creator_list_plan_started` | That list started a plan. |
| `creator_list_followed` | That list earned a follow. |

### 5.2 Map, venues and prices

| Event | Answers |
|---|---|
| `venue_sheet_opened` | A pub sheet opened on the Map, and on which pub layer. Step 3 of the release funnel. |
| `pub_viewed` | The same pub sheet read under the product-journey name, with its layer. Never summed with `venue_sheet_opened`. |
| `map_search_no_results` | A search found nothing. |
| `map_search_jump` | A search result moved the camera. |
| `map_area_switched` | The reader changed city. |
| `badge_tap` | A tonight badge on a pin was tapped. |
| `lane_card_tap` | A card in the tonight lane was tapped. |
| `lane_to_plan` | That lane handed a venue to the planner. |
| `whats_on_filter` | A what's-on filter was used. |
| `event_chip_view` | A tonight chip was shown on a venue. |
| `booking_click` | A booking link was taken. |
| `price_submit_viewed` | A price entry panel was seen. The contribution funnel's denominator. |
| `price_submitted` | A price landed. The product's core action. |
| `price_submit_outcome` | What that price turned out to be worth: trusted, still one voice, or kept on the page. |
| `price_submit_failed` | Why a price did not land. |
| `soft_drinks_water_view_opened` | The Soft drinks and water view opened, with which subtype chip was active. |
| `soft_drinks_water_price_submitted` | A drinker opened the log door from that view for a subtype. |
| `price_impact_opened` | A credited submitter opened their own impact. |
| `contribution_gate` | Where identity added friction, and which step. |
| `mission_viewed` | A ranked price mission was shown. |
| `mission_opened` | It was opened. |
| `mission_dismissed` | It was skipped. |
| `mission_submitted` | It was answered, and with what outcome. |
| `mission_newly_trusted` | That answer made a price trusted. |
| `mission_impact_opened` | The mission's impact was read. |
| `occupancy_reported` | A crowd reading was given. |
| `occupancy_read` | A crowd reading was shown, and how fresh it was. |
| `check_in_created` | Somebody said they were there. |
| `wanted_created` | A place was saved to try, and whether a source link came with it. |
| `wanted_fulfilled` | The saver reached that place. |
| `wanted_promoted` | A saved place joined the curated layer. |

### 5.3 Near and Desk

| Event | Answers |
|---|---|
| `near_answer_ready` | An answer was served, from which locality basis, and how many results. |
| `near_venue_opened` | A result was opened, and how far down the list. |
| `near_mode_switched` | Pint or Desk. |
| `desk_answer_served` | Desk answered, and whether the answer was thin. |

### 5.4 Planning and the crew night

| Event | Answers |
|---|---|
| `plan_generated` | A route came back. |
| `plan_started` | A generation request produced a route the reader can review. |
| `stop_added` | A pub joined the crawl being built, and on which surface. |
| `route_opened` | A route of two or more stops was drawn on the Map, and from which surface. |
| `crawl_locked` | A plan was accepted, with its stop count. |
| `plan_draft_saved` | An anchored one-stop draft was kept. |
| `plan_accepted` | A grounded, route-ready three-stop plan was verified server-side. |
| `plan_saved` | The plan and its route finished saving. |
| `plan_created` | A plan was created, with its stop count. |
| `plan_completed` | The night ended, how it ended, and whether it had a crew. The crew answer is the server's, minted on the completion receipt: see METRICS.md 2.2. |
| `late_food_viewed` | The food ending's shortlist was shown. See 5.10. |
| `late_food_added` | A food ending was taken. See 5.10. |
| `memory_reviewed` | The night was read back. |
| `story_published` | The night became a public story. |
| `meaningful_core_action` | The roll-up denominator for Weekly Meaningful Pubmaxxers. |
| `crew_committed` | A plan reached two committed humans. |
| `next_night_committed` | A finished night turned into the next one. The crew night loop's north star. |
| `venue_accepted` | A pub was accepted into a plan, and what context came with it. |
| `planning_handoff_opened` | A surface handed the planner a pub. |
| `night_description_submitted` | The describe-first field was used. |
| `planned_night_action` | An action was taken on a planned night. |
| `draft_recovered` | A recovered draft was offered and taken. |
| `plan_vibe_vote` | The crew voted on the mood. |
| `tour_complete` | The guided tour finished, or did not. |
| `night_mode_active` | The night surface was active. |

### 5.5 Invites, crews and the friend graph

| Event | Answers |
|---|---|
| `invite_created` | A host minted an invite link. |
| `invite_redeemed` | A guest unlocked collaboration with it. The k-factor pair. |
| `plan_invite_sent` | An invite left through a channel. |
| `content_shared` | Something left through a share channel, and which surface it came from. |
| `plan_invite_opened` | An invite was opened. |
| `plan_invite_link_copied` | The link was copied. |
| `plan_invite_link_rotated` | The link was rotated. |
| `invite_page_viewed` | The public invite page was seen, and whether it already had replies. |
| `invite_rsvp_submitted` | Somebody replied, and whether it changed an earlier reply. |
| `invite_reaction_toggled` | A reaction was added or removed. |
| `invite_map_opened` | The invite sent somebody to the Map. |
| `friend_edge_via_crew` | A mutual pair formed because both were on one crew. |
| `out_tonight_beacon_on` | The crew-only beacon went on. |
| `out_tonight_beacon_off` | It went off. |

### 5.6 Tonight, Out and the night surfaces

| Event | Answers |
|---|---|
| `tonight_screen_view` | Tonight was opened. |
| `tonight_filter_select` | A tonight filter was used. |
| `tonight_vibe_select` | A mood chip was pressed. |
| `tonight_result_opened` | A tonight row was opened, and on what locality basis. |
| `out_screen_view` | Out was opened. |
| `out_filter_select` | An Out filter was used. |
| `out_card_opened` | An Out listing was opened, and from which source. |
| `create_fab_action` | The compose action was used. |
| `night_moment_saved` | A moment was kept, and how visible. |
| `night_memory_created` | A memory was created. |
| `night_story_published` | A night story was published. |
| `recap_shared` | A recap was shared. |
| `recap_share_gate_opened` | A crew stepped toward the share consent flow. |
| `recap_viewed` | A published recap was read. See 5.10. |
| `briefing_viewed` | The morning brief was on screen. See 5.10. |
| `briefing_opened` | The brief was reached from its own notification. See 5.10. |

### 5.7 Pub Pal and the concierge

| Event | Answers |
|---|---|
| `concierge_ask` | Somebody asked the concierge. |
| `concierge_result_tap` | An answer was taken. |
| `pub_pal_summoned` | The Pal was called from a surface. |
| `voice_started` | A Pub Pal voice session connected. See 5.10. |
| `voice_ended` | A connected voice session ended, and why: the reader stopped it, it disconnected, it hit the cap, or it failed. |

### 5.8 Identity and account

| Event | Answers |
|---|---|
| `sign_in_initiated` | Which door a sign-in started at. |
| `user_signed_up` | A sign-in landed within five minutes of the account's first verification (`confirmed_at`). |
| `user_signed_in` | A person signed in. A session restored on a page load does not count. |
| `user_signed_out` | A session ended. |
| `account_switched` | A device moved between accounts it already holds. |
| `account_claimed` | A handle was claimed. |
| `social_account_connected` | A public social handle was linked, and how. |
| `founding_grant` | A claim landed inside the first hundred. |
| `message_attach_selected` | Which attachment door a message used. |

### 5.9 Install, platform and health

| Event | Answers |
|---|---|
| `pwa_install_prompt_available` | The browser offered an install. |
| `pwa_install_completed` | The install landed. |
| `pwa_standalone_launch` | The app opened installed. |
| `native_push_prompt_enable` | The push explainer was accepted. |
| `native_push_prompt_later` | It was deferred. |
| `activity_pulse` | One coarse day bucket per identity per day. The return-rate rail. |
| `web_vital` | Field performance, per metric, per route. Tile 5. |
| `error_shown` | An error notice was put in front of a reader, on which surface, and of which kind. |

### 5.10 The four loop moments

The four moments #252 named and nothing sent until 5 September 2026. Each is one
half of a ratio, so they are read as pairs and never on their own.

| Event | Answers |
|---|---|
| `late_food_viewed` | A night reached its last stop, asked for food, and was shown a shortlist. The denominator, reported for an empty shortlist too. |
| `late_food_added` | That shortlist was taken, and how confident the chosen place's hours were. |
| `briefing_viewed` | The morning brief was on screen, whether a profile shaped it, and whether the reader's own mutes filtered a pick out. |
| `briefing_opened` | The brief was reached from the daily-brief notification itself. A strict subset of `briefing_viewed`. |
| `voice_started` | A Pub Pal voice session really connected. Never the tap: a refused grant or a denied microphone is a session that did not start. |
| `recap_viewed` | A PUBLISHED recap was read, and whether its link was public or unlisted. |

Four limits that decide how these are queried.

- **`recap_viewed` is not the private recap.** `/plan/[id]/recap` reports
  `memory_reviewed` and always has. Counting both as one read would double every
  recap figure, so the private surface has exactly one name and the published one
  has exactly one name.
- **`briefing_opened` needs the marker.** It fires only on an arrival carrying the
  daily brief's own landing marker (`lib/briefingArrival.ts`), which
  `broadcastDailyBrief` writes and the service worker preserves. A brief sent
  without that URL reads as zero opens, not as zero pushes.
- **`late_food_viewed` bands at two values.** `MAX_LATE_FOOD_HANDOFFS` caps the
  served shortlist at three, so `0` and `1-3` are the whole vocabulary. A third
  band would be a value nothing can send.
- **None of the six is a Weekly Meaningful core action.** Five are impressions,
  and `meaningful_core_action` counts value taken rather than a surface seen. The
  sixth, `late_food_added`, is a real action whose night the roll-up already
  holds: the ending save that reports it is the same POST that mints
  `plan_completed`, so a second roll-up call beside it would count one night
  twice. `WEEKLY_MEANINGFUL_CORE_ACTIONS` is typed to exclude the six, so a fold
  is a compile error, and `__tests__/loopMomentEvents.test.ts` holds the
  sanitizer to the same answer.

## 6. Every registered name has an emitter

There is no list here any more, and that is the change.

This section used to name 18 events that were in the registry and sent by
nothing in `app`, `components` or `lib`: `cmdk_open`, `drop_logged`,
`planned_night_status_changed`, `pub_pal_adopted`, `pub_pal_memory_changed`,
`planning_handoff_preserved`, `map_search_ran`, `guest_plan_participated`, the
five London Capture district names, both `claim_*` steps, and the three
open-plan names. A tile built on one of them read zero for ever, and that zero
was indistinguishable from a real one.

All 18 are **deleted**, and `__tests__/analyticsEmitterFence.test.ts` is what
stops the list growing back: every name in `lib/analyticsEvents.ts` must appear
in a file that also reaches an emitter seam (`trackEvent`, `useLoopMoment`,
`trackMeaningfulCoreAction`, or the two server-side minting seams). A name and
its emitter now land in the same commit, which is the rule the six loop moments
in 5.10 already followed.

The defence for keeping an emitter-less row was that the sanitizer must know an
event's shape before its first event arrives. That is a promise about a surface
that is COMING, and it is still the right answer for one: register the name in
the commit that builds the surface. It was not the right answer for a surface
that was cancelled, never built, or lost its emitter, which is what all 18 were.
Two of them (`claim_started`, `claim_completed`) were explicitly known dead and
kept "for schema compatibility" with events that will never arrive.

What the fence proves is the cheap half: that each name is referenced from a
file that can emit. Whether a call site really fires, and fires once, stays each
event's own test's job (`components/map/useVenueSheetOpened.ts`, the
loop-moment latch, the verified completion receipt). The cheap half is the one
that was missing: all 18 failed at this bar, and nobody noticed for months.

## 7. What this plan will not measure

- **A person.** No account identity joins `distinct_id`. ADR 0009.
- **A place a stranger looked at.** `venue_sheet_opened` names a layer, never a venue.
- **A server-minted confirmation.** See 3, tile 4.
- **Time on page, session length, or a scroll depth.** Nothing in the registry carries
  a duration, and adding one would make the pseudonymous id sharper than the product
  needs it to be.
- **Traffic without consent.** Every figure here is a figure about consented visitors.
