# Horizon 0 ops checklist

Soft-launch London night OS. Captain-owned promote and cohort invite; agents
ship the product and keep this checklist current. Strategy:
[`docs/plans/PLG_STRATEGY.md`](../plans/PLG_STRATEGY.md). Scoreboard:
[`docs/growth/V1_INVITE_SCOREBOARD.md`](V1_INVITE_SCOREBOARD.md). Runbook §6:
[`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md).

## Smoke (re-verified 2026-10-30)

```sh
curl --fail --silent --show-error --location https://pubmaxxing.com/map \
  | grep -F '<title>London pub map | PUBMAXX</title>'
curl --fail --silent --show-error --location https://pubmaxxing.com/social \
  | grep -F '<title>Social | PUBMAXX</title>'
# On a rollback deployment, replace the Social marker with:
# <title>Social preview | PUBMAXX</title>
```

On 2026-10-30 both commands passed on the production host, and all three markers
passed on a local production build of `main` at `734b39e`. The old markers
(`Map · PUBMAXXING`, `Social · PUBMAXXING`) no longer match: the title template
in `app/layout.tsx` is now `%s | PUBMAXX`. The full browser walk of runbook §2 is
in [`docs/SOFT_LAUNCH_RUNBOOK.md`](../SOFT_LAUNCH_RUNBOOK.md) §7.

Captain owns the production release (`npm run release:prod`) and the human WhatsApp cohort. PR #747 (the runner change) closed unmerged; runbook §1.1 says the captain decides runner changes. Agents keep product + this checklist current.

## Product Hunt launch, 17 November 2026

The launch kit is [`LAUNCH_KIT_2026-11-17.md`](LAUNCH_KIT_2026-11-17.md): the
Product Hunt copy, the gallery shot list, the film, the press release, the
community posts, the pub pitch, the seasonal lines and the day's schedule. Every
figure in it is marked for recompute. On 16 November, on the launch head, run:

```sh
npm run launch:figures
```

It prints the hunt's figures (Britain's cheapest, each city, London's dearest)
and the priced-pub count, each with its pub, its source and its read day. It
reads the committed packs and writes nothing.

## Do not do in this wave

- Keep `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset for live Social; set it to `0` only for a full emergency rollback.
- Rebuild referral feature grants in any form (a milestone is a mark of honour: [`docs/REFERRALS.md`](../REFERRALS.md))
- Charge a drinker for anything, or gate the annual Year in Pints wrap
- Add Stripe Checkout
- Market non-London city packs for optics
- Claim “we beat Stripe” in any copy

## Merge and promote

1. DONE (2026-08-07): V1 invite-ready product work merged ([#816](https://github.com/Singularityszn/pubmax/pull/816)).
2. Merge CI runner fix ([#747](https://github.com/Singularityszn/pubmax/pull/747)) so quality gates are real.
3. Confirm migrations through `0084_crew_snapshot_wetherspoons_flag` are live (runbook §1.3; applied 2026-08-08).
4. Release to production with `npm run release:prod` ([release procedure](../DEPLOYMENT.md#one-release-command)). It builds with Production values, promotes that build and waits for the smoke run. Never promote a Preview build: promotion does not rebuild, so it keeps its Preview environment values.
5. Smoke:

```sh
curl --fail --silent --show-error --location https://pubmaxxing.com/map \
  | grep -F '<title>London pub map | PUBMAXX</title>'
curl --fail --silent --show-error --location https://pubmaxxing.com/social \
  | grep -F '<title>Social | PUBMAXX</title>'
# A rollback deployment must return <title>Social preview | PUBMAXX</title>.
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
- Social remains live by default and returns to static preview only with `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0`.
