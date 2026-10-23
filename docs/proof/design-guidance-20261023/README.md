# Design guidance and validator trial

Recorded on 23 October 2026. The baseline is `b58546dfe18ce2834e576e8378bf99cb6c475e04`.
This record covers the initial documentation and skill trial.
It excludes the later Discover touch-target repair and browser-test updates.
It does not claim a product redesign or a measured improvement in agent task completion.

## Changes

The document structure stays in place. The engineering guide now states the
owners of visual intent, runtime values, project rules, product copy, and skill
procedures. The Stitch skill preserves those owners and identifies its sibling
DESIGN.md as a new-project example. It no longer requires replacing Inter,
adding permanent animations, or prohibiting the phone sheet height animation.

The root DESIGN.md now describes the existing brick and dark semantic colours,
neutral dark shadows, and neutral tab selection. Its `primary` colour names the
existing coral value for external DESIGN.md consumers. Runtime token values and
package dependencies do not change.

Full verification found an unused `PublicEvidenceFile` type export in
`e2e/helpers/publicPageEvidence.ts`. The type is now private to that module.
This is the same one-line repair already present in PR #2337. The dead-code
check failed before that repair and passed after it. Runtime behaviour does
not change.

The older shared checkout had contradictory TrustPill instructions. The fetched
baseline already corrected those instructions. This change preserves that fix
and links the root visual specification to the same price-band rule.

## Validator trial

The npm registry and the official Google repository both identified
`@google/design.md` version `0.4.0`. The trial uses that pinned version through
npm exec. It does not install a project dependency or export application CSS.

```sh
npm exec --yes --ignore-scripts --registry=https://registry.npmjs.org --package=@google/design.md@0.4.0 -- designmd lint DESIGN.md
npm exec --yes --ignore-scripts --package=@google/design.md@0.4.0 -- designmd diff /path/to/DESIGN.before.md DESIGN.md
```

The baseline file can be recovered with `git show b58546dfe18ce2834e576e8378bf99cb6c475e04:DESIGN.md`.

| Check | Before | After |
| --- | --- | --- |
| Root specification | 0 errors, 1 missing-primary warning | 0 errors, 0 warnings |
| Validator comparison | Not applicable | `regression: false` |
| Default DOM colour subset against CSS | Not measured | All 22 declared colours match |

The [before](validator-before.json), [after](validator-after.json),
[comparison](validator-diff.json), and [token audit](token-audit.json) retain
the results. The token audit parses YAML and CSS declarations, resolves simple
variable aliases, and applies the default light or dark DOM overrides. It does
not exercise the browser cascade, component overrides, or accessibility modes.

The [probe results](validator-probes.json) include each complete input and output.
Each input was written to a temporary Markdown file and passed to the same
`designmd lint` command.

| Probe | Result | Exit code |
| --- | --- | --- |
| Black background with white text | No errors or warnings | 0 |
| Black background with black text | Contrast warning | 0 |
| Reference to a missing colour | Broken-reference error | 1 |
| Mutually contradictory trust-colour prose | No errors or warnings | 0 |

A zero exit code does not mean accessible contrast. Warnings require inspection.
The root specification contains no structured component foreground/background
pairs, so its clean result does not establish UI contrast. The tool also misses
contradictory prose and does not compare tokens with application CSS.

## Decision

Keep the validator as an optional, pinned diagnostic for DESIGN.md changes.
Do not add it to the merge gate from this trial alone. Existing component,
contrast, and token checks remain necessary. A future trial can add explicit
component pairs before evaluating whether recurring CI checks are useful.

Sources: [Google's specification and CLI](https://github.com/google-labs-code/design.md)
and [published package](https://www.npmjs.com/package/@google/design.md/v/0.4.0).

## Verification

The focused existing suite passed all 74 tests across five files:
`agentsMdTree`, `designTokens`, `launchPrimitives`, `priceBandSurfaces`, and
`accentInkContrast`. It includes rendered TrustPill behaviour and the existing
token and contrast contracts. No new source-string tests were added to claim
that a model will follow prose correctly.

Full verification also reproduced four failures in `pubListImport.test.ts`.
The suite inherited a real provider credential and invoked the model adapter
when it expected no requests. Its setup now clears `OPENROUTER_API_KEY` and
restores the environment after each test. With a non-secret ambient sentinel
key, all 78 tests pass. The assertions and application implementation are
unchanged. Failure logs were redacted before retention.

The full repository verification result is recorded with the delivery status.
