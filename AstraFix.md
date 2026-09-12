# AstraFix

Status of the PlanAstra repair work, written 12 September 2026. It records what
is merged, what is open and why, and what the next session picks up.

Read `docs/plans/PlanAstra.md` for the plan this executes, and
`Astra.md` for the earlier audit it answers.

## What is merged

| PR | Commit | What it changed |
| --- | --- | --- |
| #1638 | `800c760ee` | The merge bar is green again. `food_price_updates` carries a null budget with its reason, and the weather proof is decoupled from the whole-run summary. |
| #1637 | `9a3fa5bd4` | `/ingest` spends a per-address budget of 240 a minute through the new leaf `lib/ingestRateLimit.ts`, which compares before it records and drops an expired key. The IP hash moved to `lib/rateLimitHash.ts`, so the busiest route no longer traces `@supabase/supabase-js`. The dead hard-constraint policy is deleted. |
| #1642 | `f7b79e4a1` | Ten surfaces stop prefetching heavy routes on sight. The fence in `__tests__/linkPrefetchFence.test.ts` falls from 53 rows to 43. |
| #1647 | `048e5bc49` | The Bar Tab and the Ledger answer a failed dataset read as unavailable, never as an unknown pub, and an unreadable alias file no longer collapses into the identity map. |
| #1643 | `48f4ac8c6` | `/places` is the one city picker. It carries the canonical and the single sitemap row, `/choose-city` answers a 308 and its page is deleted, and the picker answers a UK town it does not list. |

## What is open, and the one decision that unblocks it

Five pull requests are finished work. Each one is 14 to 16 checks green with
only `Performance budget` red.

- **#1648** the interleaved A/B instrument
- **#1640** the rule that a wide run cannot decide a ceiling
- **#1644** a failed Story read answers unavailable
- **#1645** the empty Pint Index stops being advertised
- **#1636** the WhatsApp invite carries its host, and landing pints reach a drink page

### Why they are blocked

`Performance budget` cannot presently tell a slow route from a slow box. The
evidence:

- Four runs produced four different failing route sets on branches whose diffs
  cannot touch any route.
- Two runs on the identical head `fe2b740dd` disagreed.
- Against green job `103065258121`, 43 of 44 budgeted routes measured about a
  third slower on the shared `avrea-ubuntu-latest-2-vcpu` pool.

No ceiling was moved for any of this, and none may be.

### The instrument, and the decision it waits on

PR #1648 adds an A/B that rebuilds the merge base and measures it beside the
branch, in the same job, on the same box, with the navigations interleaved so
drift shared by both arms cancels in the difference. It runs only when the sweep
breaches, and it fails nothing: the breach table is still the gate.

It diagnosed its own pull request twice.

| Run | Route | Branch | Base | Verdict |
| --- | --- | --- | --- | --- |
| first | `/today` | 252 (7 of 7) | 240 (7 of 7) | not slower than base |
| re-run | `/messages` | 604 (3 of 3) | 584 (3 of 3) | not slower than base |
| re-run | `/historic` | 304 (3 of 3) | 300 (3 of 3) | not slower than base |
| re-run | `/today` | 240 (7 of 7) | 252 (7 of 7) | not slower than base |

`Astra.md` records that a red check proven to be runner noise with interleaved
A/B evidence may be re-run once on the captain's word. That re-run is spent.

**The captain decides one of two things.** Either that law extends, so a red
perf check proven to be drift by the A/B may be MERGED on the captain's word, or
#1648 merges as a one-off. Until then all five wait, and the four that predate
the instrument have no A/B evidence of their own until they rebase onto it.

## What the next session does

1. Take the decision above. It unblocks five pull requests.
2. Merge #1648, then rebase #1636, #1640, #1644 and #1645 onto it so a red perf
   check on any of them carries its own A/B verdict. All four rebase cleanly.
3. Close issue #1649. `/places` still suppresses the town fallback when a query
   substring-matches a city tagline, so typing "Chester" answers Manchester. The
   name test must anchor at the start of a word, because "manchester" contains
   "chester". This shipped in #1643 because the pull request merged while the
   rule was still with the lane.
4. Finish lane 1.13 on `fm/wave1-venue-bundles`, which holds one red-test commit
   and no implementation. Two things are missing: the Drinks tab reading its two
   overlays per venue through `/api/venue/[id]`, and the MapLibre worker named
   early with no eager fetch. Everything else that lane once listed is recorded
   as shipped in `perf/AGENTS.md`, and `/pal/chat` keeps its 911 KB on purpose.
5. Pick up issues #1641 and #1639.

## Captain calls waiting

- Whether to publish the three Astra reports into `data/`. Code now cites
  finding ids that a reader cannot resolve, because the reports live outside the
  repository.
- Two departures from earlier rulings, both recorded with their reasoning. The
  D10 admission floor required every named borough to reach it, so coverage
  growing would demote a mature Pint Index; it now admits a month when one
  borough reaches the floor. Review amendment 2 named a zone strip as a surface
  to hide, but that strip reads live map prices rather than Pint Index data, so
  hiding it would have removed a working feature.
- The shared limiter in `lib/pintDrops.ts` never evicts a key and appends a
  timestamp before it compares, so it grows under the flood it defends against.
  It is the limiter behind every `app/api` route and needs its own pull request.
