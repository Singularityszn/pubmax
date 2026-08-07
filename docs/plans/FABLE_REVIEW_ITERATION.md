# Fable review iteration — multi-PR build queue

> Status: **SHIPPING** (2026-08-07 overnight). Separate draft PRs for Fable review.
> Does **not** reopen [#816](https://github.com/Singularityszn/pubmax/pull/816) (invite-ready / WhatsApp next step / map orientation) or duplicate its ShareBar work.
> Relates to [#817](https://github.com/Singularityszn/pubmax/pull/817) (outings S1–S4 + review fixes) and [`OUTINGS_WAVE_REVIEW.md`](./OUTINGS_WAVE_REVIEW.md).

---

## Goal

Keep shipping useful product slices overnight as **small, reviewable PRs**. Each PR owns one concern, has tests, and stays inside `docs/VOICE.md`.

## Trunk / do not duplicate

| PR | Owns |
|---|---|
| [#817](https://github.com/Singularityszn/pubmax/pull/817) | Outings story, landing why, coffee taxonomy + `0082`, Open Pubs scaffold, taxonomy follow-through |
| [#816](https://github.com/Singularityszn/pubmax/pull/816) | First-map band tour, WhatsApp-first `PlanInviteNextStep`, contribution gate, invite e2e + guest map handoff |

## Opened for Fable (review in this order)

### Stacked on #817 (merge tip first)

| PR | Branch | Job |
|---|---|---|
| [#822](https://github.com/Singularityszn/pubmax/pull/822) | `fix-coffee-price-update-tests` | CI: coffee valid in drink-price update suites |
| [#821](https://github.com/Singularityszn/pubmax/pull/821) | `coffee-submit-e2e` | Coffee on price-submit path tests |
| [#823](https://github.com/Singularityszn/pubmax/pull/823) | `persona-coffee-reclassify` | Personas off `other` → `coffee` |
| [#824](https://github.com/Singularityszn/pubmax/pull/824) | `lens-reach-note-discover` | `communityReachNote` honesty; Discover lede from `MAP_LENS`; about team copy |
| [#827](https://github.com/Singularityszn/pubmax/pull/827) | `plan-occasion-chip-honesty` | `inferNightContext` honours every describe-first chip |
| [#830](https://github.com/Singularityszn/pubmax/pull/830) | `spoons-plan-prefer` | Soft-prefer directory-matched Spoons in ranking (no hard filter, no prices) |
| [#828](https://github.com/Singularityszn/pubmax/pull/828) | `coffee-sheet-drink-lens` | Venue sheet drink-lens honesty (**prefer over #826**) |
| [#826](https://github.com/Singularityszn/pubmax/pull/826) | `coffee-lens-empty-states` | **Superseded by #828** — close when #828 chosen |
| [#825](https://github.com/Singularityszn/pubmax/pull/825) | `open-pubs-london-report` | Open Pubs London curated match report |
| [#833](https://github.com/Singularityszn/pubmax/pull/833) | `scraper-coffee-categories` | Greene King / MBPLC / refresh scrapers → coffee, soft-drink, AF |
| [#834](https://github.com/Singularityszn/pubmax/pull/834) | `outing-generate-copy` | Generate API + Pal/Ask + SiteNav outing copy |
| [#836](https://github.com/Singularityszn/pubmax/pull/836) | `landing-outing-beat` | Landing `#why` outing jobs + about press positioning |

### Independent of coffee taxonomy

| PR | Branch | Job |
|---|---|---|
| [#819](https://github.com/Singularityszn/pubmax/pull/819) | `map-sheet-outing-copy` → `main` | Map-sheet "Describe the outing" |
| [#831](https://github.com/Singularityszn/pubmax/pull/831) | `plan-outing-chrome` → #819 | "Plan tonight" → "Plan an outing" chrome |

### Skipped / already owned

| Item | Why |
|---|---|
| Guest RSVP → map prompt | Already on #816 (`InviteMapLink` / e2e map handoff) |
| WhatsApp invite next step | #816 |
| Captain applies `0082` | Ops, not an agent PR |

## Execution rules

1. One concern per PR; prefer stacked base notes in the PR body when depending on #817.
2. No invented biography, fake counts, or Wetherspoons app reverse.
3. Captain applies migrations — agents only ship SQL.
4. Do not touch `AuthProvider` token-fragment paths.
5. Commit + push + open/update draft PR per branch before claiming done.

## Fable checklist (tomorrow)

- [ ] #817 outings trunk
- [ ] #816 invite-ready V1 gaps
- [ ] #822 → #821 → #823 coffee test/persona follow-through
- [ ] #824 lens reach + Discover lede
- [ ] #827 chip honesty, then #830 Spoons prefer
- [ ] #828 sheet lens (close #826)
- [ ] #833 scraper category sync
- [ ] #834 + #819 + #831 outing copy stack
- [ ] #825 Open Pubs London report
- [ ] #836 landing outing beat
- [ ] Captain: apply migration `0082` on Supabase
