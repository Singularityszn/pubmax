# V1 invite scoreboard

Operator scoreboard for the soft-launch London cohort. Not a Social launch:
`SOCIAL_INVITE_BETA_ENABLED` stays unset. Product stance lives in
[`docs/plans/PLG_STRATEGY.md`](../plans/PLG_STRATEGY.md); the operator checklist
is [`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md) §6.

## Cohort

| Item | Target |
|---|---|
| Who | 15–40 London drinkers you already WhatsApp nights with |
| What | Map + plan invite + price logging |
| Seed boroughs | 1–2 (e.g. Soho + Camden) with corroborated people-logged prices before the blast |
| Ads | None for week 1 |

## Weekly PostHog reads

Consent-gated events only ([`docs/METRICS_FUNNEL.md`](../METRICS_FUNNEL.md)).
Project: `https://eu.posthog.com/project/219466`.

| Metric | How to read it |
|---|---|
| Invite share actions | `plan_invite_sent` + `plan_invite_link_copied` after `plan_saved` |
| Invite k-factor (public page) | `invite_rsvp_submitted` / `invite_page_viewed`; also `invite_map_opened` / `invite_page_viewed` |
| Classic invite redeem (if used) | `invite_redeemed` / `invite_created` |
| Price conversion | `price_submitted` / `price_submit_viewed` (signed-in sheet opens) |
| Meaningful plan actions | `plan_saved`, crew joins, invite share |
| Return pulse | `activity_pulse` |
| Social DAU | Do not track while Social stays in preview |

## Week-1 pass bar

- ≥10 distinct humans opened the map
- ≥5 RSVPs or price logs
- No paid ads
- Social surfaces remain preview-only

## Physical posters

Optional only after the digital cohort works. Spec:
[`docs/growth/POSTER_SPEC.md`](POSTER_SPEC.md) into `/near?utm=…`.
