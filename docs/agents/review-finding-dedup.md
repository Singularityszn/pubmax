# Review finding duplicate check

`scripts/review-finding-dedup.mjs` reports repeated review findings. It never edits the input or dismisses a finding. Security findings follow the same review-only rule.

## Input

Pass one JSON list. Each finding needs five non-empty strings:

```json
[
  {
    "id": "Q-01",
    "file": "lib/example.ts",
    "summary": "Authorization check is missing",
    "evidence": "The update path accepts an unrelated account identifier.",
    "revision": "abc123"
  }
]
```

`revision` identifies the reviewed commit or snapshot. Optional `severity` and `category` values must be strings of at most 100 characters.

## Offline check

```sh
node scripts/review-finding-dedup.mjs findings.json > duplicate-report.json
```

Offline mode groups records whose fields are exactly equal after excluding `id`. Every input record stays in place. A difference in evidence, severity, category, file, revision, or any other field prevents an exact match.

## Jev suggestions

Load `TYPESAFE_API_KEY` from the operator environment, then run:

```sh
node scripts/review-finding-dedup.mjs findings.json --jev > duplicate-report.json
```

The Jev pass checks at most eight non-exact pairs from the same file and revision. It skips pairs whose optional severity or category differs. Each request carries at most 240 summary characters and 800 evidence characters per finding, uses a five-second timeout, and has no retry. The report sets `jev.pairLimitReached` when more pairs existed.

`--jev` sends those bounded summaries and evidence to TypeSafe. Supply reviewed, non-secret data only.

Jev output is advice for a reviewer. Probability `0.9` or higher produces `review_possible_duplicate`. This threshold is provisional and has not been calibrated as a quality measure. Lower probabilities produce `retain_uncertain`, and request or response failures produce `retain_failed`. Truncated input produces `review_possible_duplicate_bounded_evidence`, which tells the reviewer to inspect the full findings. No result removes either record.

The report contains IDs, file paths, revisions, decisions, probabilities, model name, request count, and API usage. It does not copy summaries or evidence into stdout or error output. `jev.usage` is `null` when no call ran or complete API usage was unavailable. The tool does not replace missing usage with zero.

Run the standalone tests directly. They are outside Vitest's configured include pattern and do not run under `npm run verify`.

```sh
node --test __tests__/reviewFindingDedup.test.mjs
```
