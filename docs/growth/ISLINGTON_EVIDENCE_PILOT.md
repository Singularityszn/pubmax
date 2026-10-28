# Islington evidence pilot

Status: prepared, not collected or published. The founder owns collection in November 2026.
Publication needs real evidence, the existing checks, and owner approval.

This pilot extends Wave 2 of [the growth strategy](../plans/PLG_STRATEGY.md).
It supports exact-order comparisons and the public Pint Index through their separate evidence rules.

## Target and boundaries

Document 25 to 30 distinct pubs inside Islington's canonical boundary during November 2026.
The buffer allows some records to fail review. It does not change the publication threshold.

The Index needs 20 qualifying distinct pubs in one borough within one UTC month.
For this pilot, the window is `2026-11-01T00:00:00.000Z` through `2026-11-30T23:59:59.999Z`.
November London time is GMT. Keep the stored instant and the UTC grouping rule for every month.

The five collection categories are beer, wine, alcohol-free drinks, coffee, and soft drinks.
Only eligible beer-pint evidence can enter the Pint Index.
Other categories support comparisons under their own existing price rules.
Do not require every pub to offer every category. Record missing information as unknown.

A menu inspection does not require buying or consuming a drink.
Do not create drinking targets, consumption rewards, or fabricated second reports.

## Collection procedure

1. Resolve the pub's stable venue ID and exact branch from existing venue data.
2. Check its point against the canonical borough boundary.
3. Check source permission before any automated menu fetch.
4. Record the drink name, category, exact serving, price, currency, and any stated conditions.
5. Retain the public source URL, publisher, source class, and date meaning.
6. Record the source's price date separately from the date you read it.
7. Route each record through its existing producer and review process.
8. Run the diagnostic against the resulting candidate snapshot before publication.

Names alone cannot identify a branch. An official chain menu must apply to that exact branch.
Do not infer serving sizes, scale a half into a pint, or silently substitute another drink.
Do not backdate a record or replace an unknown source date with the read date.

| Source class | Required evidence | Existing boundary |
|---|---|---|
| Confirmed Pint Drop | Public source URL, price observation date, live confirmation, stable pub identity | Existing confirmation producer and moderation rules |
| Official pub or brewery | Public source URL, matching official domain, exact branch, dated price evidence | Source permission and reviewed ingestion path |
| Licensed open data | Named dataset, licence, public source URL, dated price evidence | Source permission and reviewed ingestion path |
| Directory or unconfirmed report | Keep its actual source and limitations | Does not qualify merely because the map can display it |

The current snapshot builder reads confirmed Pint Drops. Validator support for official or licensed sources does not establish an ingestion path.
If that path is missing, hold the collected source for review. Do not hand-edit a generated snapshot to admit it.
Never change source classifications to fit the producer.

Keep receipts, contributor details, and private collection notes in their existing protected stores.
Publish only the permitted evidence fields. Do not place private material in a shared report or a source URL.

## Read-only diagnostic

`diagnosePintIndex` in `lib/pintIndexDiagnostics.ts` reads a candidate value and returns a report.
It calls the existing snapshot validator and admission rule. It performs no fetches or writes.

Run this command from the repository after its approved dependency installation:

```sh
npx --no-install tsx -e 'import { readFileSync } from "node:fs"; import { diagnosePintIndex } from "./lib/pintIndexDiagnostics"; console.log(JSON.stringify(diagnosePintIndex(JSON.parse(readFileSync("public/data/pint_index_snapshot.json", "utf8"))), null, 2));'
```

| Report field | Meaning |
|---|---|
| `status` and `validationErrors` | Whether the existing structural validator accepts the whole snapshot, with its exact refusal reasons |
| `admitted` | The existing admission result, or `null` when validation prevents a decision |
| `records` | Each input observation's index, venue ID, and relevant validation reasons |
| `groups` | Qualifying UTC-month and borough groups, distinct venue IDs, count, and remaining gap |
| `exclusions` | Existing producer exclusions, kept separate from accepted records |

A record marked `qualified` passed structural validation. The diagnostic does not independently verify the source's factual accuracy or permission.
Duplicate observations can pass validation, but the latest observation per pub decides the monthly count.
A record marked `blocked` cannot be admitted because another part of its snapshot failed validation.
An invalid snapshot has unknown admission and counts. It does not prove that the borough has zero evidence.

At baseline commit `66a3db187`, direct inspection of the committed snapshot showed:

| Field | Recorded value |
|---|---|
| Snapshot status | `empty` |
| Generated at | `2026-07-16T00:00:00.000Z` |
| Source records | 0 |
| Observation records | 0 |
| Excluded legacy records | 2,796, under `source_not_eligible_for_public_index` |

These are file-inspection facts, not an executed diagnostic or a fresh collection.
Directory coverage and fare-zone summaries do not establish admitted Index coverage.
The pilot has no collected evidence yet, so its remaining target is not a claim about live community submissions.

## Publication and follow-up

1. Review the actual diagnostic and resolve every validation error.
2. Confirm that each proposed source has permission and the required factual evidence.
3. Publish through the existing producer after the owner authorises publication.
4. Reinstate the snapshot freshness budget with its first published observation, as the existing builder rules require.
5. After the month closes, use the existing frozen-edition workflow.
6. Prepare a Price Pulse draft from the permitted evidence and seek its separate editorial approval.

The Index threshold does not approve an editorial or a deployment.
An empty or thin month stays honest. Existing frozen editions remain unchanged.
Any correction uses the existing correction workflow and records what changed.

Report category coverage separately for each drink category. Show unknown servings and missing prices beside the coverage result.
Do not compare incomplete orders with complete totals or call a mixed-drink result an Index statistic.
The working name "Pint Pentagon" describes the five collection categories. It grants no reward or product access.
