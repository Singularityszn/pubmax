# Slice 01: Grounded free-text constraints

## Contract

A free-text ask that explicitly requests supported access needs must never
return a Stop without checked evidence. Tonight Agent must use the same
completed-intake request seam as Plan's describe-first entry.

## API Seam

- Extend `selectPlanGenerationCandidates` and
  `selectAnchoredPlanGenerationCandidates` to resolve supported access needs
  from authoritative intake when answered, otherwise from reconciled Night
  Context.
- Add `buildTonightAgentGenerateBody(query)` in `lib/tonightAgent.ts`. It
  returns `{ query, intake }` using the existing skip-all Plan intake handoff.
- `components/plan/TonightAgentPanel.tsx` sends that body.

## Verification

- `__tests__/planRouteConstraints.test.ts`: context-derived `step-free` is a
  hard constraint when intake accessibility was skipped.
- `__tests__/planGenerateRoute.test.ts`: unknown access returns the existing
  `GROUNDED_CONSTRAINTS_UNSATISFIED` response.
- `__tests__/tonightAgent.test.ts`: request builder includes a valid completed
  intake and trimmed query.

Keep every existing Plan generation and Tonight Agent test green.

