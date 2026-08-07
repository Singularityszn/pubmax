# Horizon 0 ops checklist

Soft-launch London night OS. Captain-owned promote and cohort invite; agents
ship the product and keep this checklist current. Strategy:
[`docs/plans/PLG_STRATEGY.md`](../plans/PLG_STRATEGY.md). Scoreboard:
[`docs/growth/V1_INVITE_SCOREBOARD.md`](V1_INVITE_SCOREBOARD.md). Runbook §6:
[`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md).

## Smoke (re-verified 2026-08-07)

```sh
curl -sSIL https://pubmaxxing.com/map          # HTTP/2 200
curl -sSIL https://pubmaxxing.com/social       # HTTP/2 200 (preview; flag unset)
```

Captain still owns merge of #816 / #747, `vercel promote`, and the human WhatsApp cohort. Agents keep product + this checklist current.

## Do not do in this wave

- Enable `SOCIAL_INVITE_BETA_ENABLED`
- Unlock referral grants
- Add Stripe Checkout
- Market non-London city packs for optics
- Claim “we beat Stripe” in any copy

## Merge and promote

1. Merge V1 invite-ready product work ([#816](https://github.com/Singularityszn/pubmax/pull/816)) when green.
2. Merge CI runner fix ([#747](https://github.com/Singularityszn/pubmax/pull/747)) so quality gates are real.
3. Confirm migrations through `0081_plan_public_invite` are live (runbook §1.3).
4. Promote the production deployment (`vercel promote <url>`).
5. Smoke:

```sh
curl -sSIL https://pubmaxxing.com/map | head -n 1
curl -sSIL https://pubmaxxing.com/social | head -n 1
# Social must stay preview; flag unset on the production project.
```

## Cohort invite (15–40 drinkers)

1. Seed corroborated people-logged pints in 1–2 boroughs first (Soho / Camden).
   Playbook: [`SEED_BOROUGH_PLAYBOOK.md`](SEED_BOROUGH_PLAYBOOK.md).
2. WhatsApp a real upcoming night: map link + plan invite + one-line ask.
3. Do not run ads in week 1.
4. Fill the weekly scoreboard from PostHog (project `219466`).

## Week-1 pass bar

- ≥10 distinct map opens
- ≥5 RSVPs or price logs
- Invite share on most successful locked plans
- Seed boroughs not empty grey on first open
- Social remains preview-only
