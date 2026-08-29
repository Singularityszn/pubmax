# Crew Night Loop (Social Wave S1)

> Status: **EXECUTING** - plan PR lands first; product slices ship as separate draft PRs on `cursor/*-dd0b`.
>
> Owns the **invite-first Social layer** that sits on the Night OS trust spine. Social is live by default; set `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` only for emergency rollback. Does **not** reopen WhatsApp CTA structure from `#816` (`PlanInviteNextStep`).
>
> Drafted 2026-08-08 from first-principles outings, Harris Poll Gen Z Weekend Report (July 2026), UK soft-socialising research, and shipped seams (plan invite, out-tonight check-in, last crew, soft occasion chips).

---

## 0. North star

> Make the next soft, affordable, low-pressure IRL plan with your lot so obvious that staying in is the harder choice.

**Primary metric:** share of nights where a plan reaches **≥2 committed humans** (`crew_committed` with `participants >= 2`). Not scroll DAU on `/social`.

**Loop:**

```text
Truth (map) → Soft plan (occasion + cost) → Invite (1 link) →
Out-tonight / crew presence → Show up → Safe home → Memory → Invite again
```

---

## 1. First principles (what this wave is not)

| Do | Do not |
|---|---|
| Crew of 3–8, invite-only / mutual | Public stranger heat-map |
| Alcohol-optional soft occasions first | Nightlife-only Social |
| Honest £ spend on the invite | Invented budgets |
| Friends-gated check-ins | Area-public densification without sign-off |
| Chronological / consent memory later | Algorithmic For You / dating adjacency |
| Keep Social live by default | Open `/social` feed theatre |

Social engagement must never move pin colour, cheapest buckets, or the Pint Index.

---

## 2. Research spine (why S1 looks like this)

Harris Poll Gen Z Weekend Report (July 2026): 51% weekend loneliness; 68% say going out hurts the wallet; 62% avoid plans to dodge regret; 73% want social settings where alcohol is not the main focus; 62% wish online friendships became IRL plans.

UK trade press (2026): pubs under outlet pressure; Gen Z still gathers via soft formats (run clubs, coffee, structured hangs). Competitors own invites (Partiful) or stranger FOMO maps (Moves/Toki) — neither owns honest UK pub outing truth.

**Wedge:** Partiful-grade invite + friends-only “who’s out”, sitting on PUBMAXX price/occasion truth.

---

## 3. Execution slices (separate PRs)

Ordered for parallel work; later slices must not block earlier merges.

| # | Branch | PR job | Key seams | Avoid |
|---|---|---|---|---|
| 0 | `cursor/crew-night-loop-plan-dd0b` | This plan + README index | `docs/plans/` | No product code |
| 1 | `cursor/crew-northstar-metric-dd0b` | Scoreboard + funnel docs for `crew_committed` `participants >= 2`; pin tests | `docs/METRICS_FUNNEL.md`, `docs/growth/V1_INVITE_SCOREBOARD.md` (create if missing), analytics tests | No UI / WhatsApp CTA |
| 2 | `cursor/invite-spend-band-dd0b` | Honest £X–Y pp on invite share text, `/invite/[token]` copy, OG when stop prices complete; omit when incomplete | `lib/shareArtifacts.ts`, `planPresentation.ts`, invite page + OG | Do not redesign `PlanInviteNextStep` |
| 3 | `cursor/soft-occasion-defaults-dd0b` | Soft defaults: describe-first / Tonight → plan handoff / landing Why → `/plan` for AF, coffee, chill | `PlanDescribeFirst`, Tonight vibe chips, landing links | No ShareBar; no launch-flag change; no taste CSS churn |
| 4 | `cursor/crew-tonight-board-dd0b` | Friends-only “who’s out” board over `visibleCheckInsForViewer`; keep `/we-are-out` honest under live or rollback state | check-in feed, You/lot surface, `WeAreOutClient` | No area-public densify |
| 5 | `cursor/usual-lot-reinvite-loop-dd0b` | Completed-plan → usual-lot nudge; emit `next_night_committed` with closed `source` (`crew-reinvite` / `completed_plan`) | `LastCrewInvite`, `lastCrew.ts`, analytics emission | No Social crew snapshot RPC; no new server roster table |

---

## 4. Wave S2+ (parked until S1 retention)

- Crew-to-crew / friend-of-friend soft discovery
- Recurring formats (Sunday quiet Spoons, Thursday AF)
- Full Verified Social Night Loop feed (needs named moderators per `docs/social/SOCIAL_BETA_CONTRACT.md`)
- Safe-home pride pass (builds on Getting Home strip already shipped)

---

## 5. Voice and honesty

Follow `docs/VOICE.md`. No em dashes, no exclamation marks, British spelling. Jokes stay off spend figures, dates, and legal copy. Landing and `/we-are-out` must describe live Social by default and preview during explicit rollback.

---

## 6. Definition of done for S1

- [ ] Plan doc on `main`
- [ ] North-star metric documented and test-pinned
- [ ] Invite artifact can show an honest spend band (or silence)
- [ ] Soft occasion path visible without changing Social launch state
- [ ] Friends-only crew tonight surface + We-are-out honesty
- [ ] Usual-lot reinvite emits `next_night_committed`
- [ ] `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` rollback remains documented in `.env.example` and soft-launch runbooks
