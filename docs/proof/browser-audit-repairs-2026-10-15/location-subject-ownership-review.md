# Complete food subjects and coordinated venue names

This round addresses only `location-subject-ownership`.
The review base is `599252af3019f3776b5d78d297fae2d871fbd87f`.
The starting and current HEAD is `acaa6575a7b5fb7908d0063faa9d2db222559c1c`.
The fixes remain uncommitted in this worktree.
The file hashes below identify the tested changes.

The invariant is that location masking must preserve purchased food subjects and complete coordinated venue names.
It applies to leading and trailing prices, all location prepositions, all four joins, query text, and valid structured `foodNeeds`.
Its consumers are meal classification, serving validation, route-budget inference, pint ceilings, and canonical candidate selection.

The [before output](location-subject-ownership-before.txt) records four failures through executable preparation and POST against unchanged production code.
`£10 pint at pub and a slice of pizza` incorrectly succeeded in query text and valid `foodNeeds`.
`£5 pint at Cock and Bottle serving pizza` incorrectly returned the meal limitation in both representations.
The initial four cases used the existing supported-case clock, `2026-10-15T12:00:00Z`.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts -t 'retains complete location subjects' --reporter=dot
```

The defect came from separate food-subject definitions and a short location-item rule.
`PLAN_FOOD_SUBJECT` now supplies the same food recognition for direct prices, coordinated items, location subjects, and modifier termination.
It retains portions, containers, fractions, quantities, adjectives, and pub-modified foods.
The location parser consumes complete coordinated title-case venue names before examining purchased-item joins.
It recognises name structure without hardcoded venue names.
Location spans preserve the original offsets and amounts when they project subject text.
The unused external boundary export and the duplicate local food-subject definition were removed.
No paid call, fallback, retry, state store, code comment, or unrelated UI change was added.

The new matrix covers both price directions and input representations across `and`, `plus`, `+`, and `&`.
It covers portions and qualified foods after every existing location preposition.
It also covers coordinated venue names containing food and drink words, compact symbolic joins, and unpriced amenities.
Long named-venue phrases remain query cases because each structured `foodNeeds` entry has a 40-character contract.
The two original phrases and the portion matrices include valid structured counterparts.
Refusals assert the meal limitation through preparation and POST, no venue loading, and no paid allowance consumption.
Successes assert three stops, unchanged route-budget meaning, and fresh canonical prices within the cap for candidates, stops, and alternatives.

The [intermediate output](location-subject-ownership-intermediate.txt) records 3,256 passes and 40 failures.
The shared rule initially excluded the direct price connector `for`, allowing explicit route-budget exceptions to accept existing priced-food cases.
The direct-price consumer now consumes that connector before applying the shared food subject.
All existing assertions remain intact.

Before final verification, the trace covered both reported failures and ordinary caller paths.
`planPriceLocationSpans` preserves a portion join and consumes the complete coordinated venue name.
`planPriceSubjectText` keeps offsets stable for `planPriceAmounts` and `hasMealPriceConstraint`.
`hasMealPriceConstraint` recognises direct food prices, priced food lists, and bundles through the shared food rule.
`planPriceAmounts` retains serving validation and supplies `planPriceLimits`.
`planPriceLimits` still serves `inferNightContext` and preparation, taking the strictest accepted route budget and pint ceiling.
Preparation rejects unsupported meals before venue loading and paid allowance consumption.
POST returns that refusal or continues through ordinary canonical selection.
The direct `for` connector preserves existing food-price refusals without changing independent drink and route-budget clauses.
No helper, branch, parameter, or alias became unreachable.

The [after output](location-subject-ownership-after.txt) records all 3,296 tests passing without skips, with exit code 0.
This includes 703 new behavioral cases and every existing case in the focused route suite.
The existing cases cover serving validation, meal bundles, separate route-budget clauses, strict limits, and canonical selected and alternative prices.

```sh
node_modules/.bin/vitest run __tests__/planGenerateRoute.test.ts --reporter=dot
```

| File | SHA-256 |
| --- | --- |
| Starting `lib/planPriceLimits.ts` | `d7f97c3c9ccaed6f350dee49b5264a35814d13445c6ba830322fe548e6753040` |
| Tested `lib/planPriceLimits.ts` | `15073db505129afcabe47f6c26f6a57d8fb40999d7b4686df6c8b75770a4948d` |
| Starting `lib/planGeneration.server.ts` | `232296f24d3ad2babbe12b7fb4c2dc3c8ccdc6a0b3a5f0fd52a0410ec33bb1b5` |
| Tested `lib/planGeneration.server.ts` | `fb1dd2777f7d469217469f64263fdb08778baaf8516b1ce0f674784b4d29dda6` |
| Starting `__tests__/planGenerateRoute.test.ts` | `356fb9b5cff90f700177cbd4dd0a65cb1552115f8ee05003598a99cd955a5739` |
| Tested `__tests__/planGenerateRoute.test.ts` | `7130f614c0afdfe673dbdc57de3c4915be43d6f8b9b560bb50c21ac0da7959d2` |
| Tested `lib/nightPlanning.ts` | `e54a6ce5b241d74989ef3297add769158c70d782a20a615fe4c9b52ba7c4cefc` |
| Tested `app/api/plans/generate/route.ts` | `24f07776a661cdbcce69789446d975703e972e0de8f643071d1129924e95f6b6` |

The tested source-and-test diff SHA-256 is `063da9d5e226a68648f45635058d30e8781cefbc7b35777861cc62ad6eca3e39`.
The diff contains only the three changed code and test files listed above.

The tests execute preparation and POST with mocked service boundaries and committed canonical venue data.
They do not establish live HTTP, browser, authenticated Pub Pal, provider privacy, physical-device behaviour, retention, or full-product acceptance.
This phase ran no complete repository test suite, lint suite, CI, publication, merge, or deployment.
The outer executor owns those phases.
Declined findings, prior fixes, and earlier proof records remain unchanged.
