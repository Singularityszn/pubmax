# V1 invite scoreboard

Operator scoreboard for the soft-launch London cohort. Social is live by
default when `PUBMAX_SOCIAL_FRIENDS_LAUNCH` is unset; `=0` is a full emergency
rollback to static preview. Product stance lives in
[`docs/plans/PLG_STRATEGY.md`](../plans/PLG_STRATEGY.md); the operator checklist
is [`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md) §6 and
[`docs/growth/HORIZON0_OPS_CHECKLIST.md`](HORIZON0_OPS_CHECKLIST.md).

## Cohort

| Item | Target |
|---|---|
| Who | 15–40 London drinkers you already WhatsApp nights with |
| What | Map + plan invite + price logging |
| Seed boroughs | 1–2 (e.g. Soho + Camden) with corroborated people-logged prices before the blast |
| Ads | None for week 1 |

## Crew Night flow ratio (S1)

Plans with **at least two committed humans** on the crew roster. No new event:
reuse the exactly-once `crew_committed` threshold event and filter
`participants = 2`. Full formula and rationale:
[`docs/METRICS_FUNNEL.md`](../METRICS_FUNNEL.md) §0. The loop north
star is `next_night_committed`; its emitter and privacy contract live there.

```
crew_nights_with_two_or_more = count(crew_committed WHERE participants = 2)
crew_night_flow_ratio        = crew_nights_with_two_or_more / count(plan_saved)
```

Count the database-minted opaque event identity once. Migration `0125` records
one threshold occurrence and one random event ID inside the canonical
membership transaction. Ordinary joins, private invite redemption, and public
Going RSVPs return that evidence only to its member. Join retries, concurrent
third joins, signing-key rotation, and leave-rejoin cycles do not add Crew
Nights.

`crew_night_flow_ratio` is an operational flow ratio, not a share, conversion,
or cohort rate. Its independent event-time flows mean it may exceed 1 when a
Plan saved before the read window reaches two people inside the window. No Plan
ID enters analytics to join numerator and denominator into a cohort.

There is no backfill for Plans that already had two or more active members when
`0125` is applied. Deploy app code with missing-function fallback first, drain
old server versions, then apply `0125`. Scoreboard cohort starts at migration
application. This app-first order prevents an old public Going response from
creating an undelivered threshold. Compatible old RPC names are rollback safety,
not permission to reverse the order.

Do not substitute `invite_rsvp_submitted`. Maybe is intent only. Going counts
only when its server-confirmed canonical membership returns the threshold token.
Track Social only for an explicit, consented product question; do not use it as
a vanity launch metric during rollback.

## Weekly PostHog reads

Consent-gated events only ([`docs/METRICS_FUNNEL.md`](../METRICS_FUNNEL.md)).
Project: `https://eu.posthog.com/project/219466`.

| Metric | How to read it |
|---|---|
| **Crew Night flow ratio** | `crew_committed` where `participants = 2` divided by `plan_saved`; operational flow ratio may exceed 1 |
| Invite share after `plan_saved` | `plan_invite_sent` + `plan_invite_link_copied` |
| Invite k-factor (public page) | `invite_rsvp_submitted` / `invite_page_viewed`; also `invite_map_opened` / `invite_page_viewed` |
| Classic invite redeem (if used) | `invite_redeemed` / `invite_created` |
| Price conversion (signed-in) | `price_submitted` / `price_submit_viewed` |
| Landing CTA mix | `landing_cta_clicked` by `target` (`map` / `near` / `plan`) |
| Meaningful plan actions | `plan_saved`, crew joins, invite share; also `meaningful_core_action` |
| Return pulse | `activity_pulse` |
| Seed borough coverage | Pint Index seed strip + corroborated beer counts (playbook) |
| Social DAU | Track only for an explicit, consented product question; unavailable during `=0` rollback |

## Week-1 pass bar

- At least one plan reaches `crew_committed` with `participants = 2`
- ≥10 distinct humans opened the map
- ≥5 RSVPs or price logs
- Invite share on most successful locked plans
- Seed boroughs not empty grey on first open
- No paid ads
- Social is live by default; `=0` must show static preview only

## Physical posters

Optional only after the digital cohort works. Spec:
[`docs/growth/POSTER_SPEC.md`](POSTER_SPEC.md) into `/near?utm=…`.
