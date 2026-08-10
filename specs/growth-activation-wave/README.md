# Growth Activation Wave

Status: in progress, last updated 10 August 2026.

## Next Agent Prompt

Implement slices 01 to 03 in their named isolated worktrees. Start with the
failing tests. Preserve existing Plan, Crew, Night Memory, Pint Index, and
analytics owners. Before ending a pass, update this status and the checklist.

- [ ] Slice 01: enforce free-text access constraints through the existing grounded planner.
- [ ] Slice 02: offer the usual lot from the one-time morning recap card.
- [ ] Slice 03: add Islington as the fifth seed-borough campaign row.
- [ ] Integrate commits and run targeted tests, lint, typecheck, and diff checks.

## Goal

Close the remaining day-zero growth gaps without rebuilding work already on
`origin/main`: honest free-text constraints, a direct next-night crew loop, and
a five-borough evidence pilot.

## Slice Graph

1. `slices/01-grounded-free-text-constraints.md` fixes the decision contract.
2. `slices/02-morning-usual-lot.md` composes the existing recap and crew loop.
3. `slices/03-five-borough-pilot.md` expands the existing status campaign.

Slices are independent and may run in parallel. Integration follows in this
order because planner behavior carries the highest user-risk.

## One-Owner Invariants

- `lib/planGenerationSelection.server.ts` remains the only bridge from Night
  Context into grounded route constraints.
- `lib/lastCrew.ts` remains the only usual-lot storage and analytics-prop owner.
- `lib/boroughCoverageStatus.ts` remains the only seed campaign definition.
- No new recommendation engine, crew store, recap entity, borough page,
  analytics duration property, or public price archive is allowed.

## Scope Firewalls

- Public Pint Index snapshot currently contains zero eligible observations.
  Do not publish a weekly price claim, fabricate a league, or promote legacy
  competitor-derived prices.
- Transport constraints remain unsupported by the grounded optimizer and must
  return scarcity rather than be silently relaxed.
- Memories and crew rosters stay private by default.
- Reward evidence and coordination, never alcohol volume.

## Review Map

- Slice 01: targeted Vitest route and optimizer tests.
- Slice 02: component source contract plus usual-lot tests. Visual review is
  required on the integrated build at phone width before release.
- Slice 03: pure unit test and playbook review. No new visual component.

## Deferred Work

- Weekly original price release starts only after `pint_index_snapshot.json`
  contains eligible observations with a public source, observation day, stable
  Venue ID, and canonical borough.
- External Reddit, X, and creator posting stays owner-led. This wave prepares
  product loops and does not publish on the founder's behalf.

