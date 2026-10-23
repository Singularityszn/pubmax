# Schema markup repair, 23 October 2026

The live audit found identity errors in valid JSON-LD. Schema.org defines `sameAs` as a URL that identifies the same entity. A citation about an entity does not necessarily identify it.

## Before and after

| Surface | Published markup before repair | Repair |
| --- | --- | --- |
| Shared Organization | `sameAs` names the founder's personal X and GitHub profiles. | The founder Person owns both links. The Organization claims neither profile. |
| AboutPage | `about` and `isPartOf` define unnamed-ID copies of the Organization and WebSite. | Both properties reference the shared canonical `@id` values. The shared Organization retains the public email. |
| The Grapes | `sameAs` includes a photographic print product page. | Only its single Wikipedia identity remains. The visible citation remains. |
| Black Lion | `sameAs` equates the pub with the Kilburn and Hammersmith Wikipedia entries. | The ambiguous identity claim is omitted. Both visible citations remain available for reconciliation. |

The historic filter accepts Wikipedia or Wikidata source records with an English Wikipedia article URL or a Wikidata entity URL. It emits identity links only when one unique reference remains. Multiple references can be legitimate, but these records do not establish that they describe one entity. Omission is deliberate until reconciliation supplies that evidence.

The committed before JSON files contain the relevant identity excerpts. Full captured graphs remain in the local audit artifacts.

## Reproduction and regression checks

The live `/about` identity assertion failed before repair. Its Organization claimed personal profiles and its AboutPage lacked the canonical Organization reference.

The updated homepage identity test failed before the profile fix. The updated AboutPage test failed before the canonical-reference fix. Two historic tests failed before the citation filter. Each test then passed with its repair.

`npx vitest run __tests__/historicSchema.test.tsx __tests__/homepageIdentity.test.ts __tests__/aboutPintIndexStory.test.ts __tests__/seoJsonLd.test.ts __tests__/inlineScriptJson.test.ts __tests__/siteContact.test.ts __tests__/ledgerJsonLd.test.tsx __tests__/drinkBrandLandingPage.test.ts __tests__/drinkBrandAreaLandingPage.test.ts` passed 61 tests across nine files.

These checks execute rendered page output or the shared graph. Existing serializer and nonce checks also passed.

## Live audit coverage

`before-summary.json` records twelve public routes covering all JSON-LD emitter families. All returned HTTP 200, parseable JSON-LD and production canonical URLs. `/pint-index` intentionally emits no Dataset when no observation window exists. The archived empty edition emits a Dataset without a downloadable distribution.

Schema.org's public validator reported zero errors and zero warnings for the published About, Camden borough and Spoons Value pages. This covers WebSite, Organization, Person, AboutPage, BreadcrumbList, ItemList, FAQPage and Dataset. These syntax results did not detect the identity errors above.

## Test dependency

A post-build full-suite run exposed the existing hours-evaluation fixture issue. The focused reproduction returned 25 failures because recorded Places hours made nominally unknown fixtures known. [PR #2345](https://github.com/Singularityszn/pubmax/pull/2345) supplied the fixture repair and shared evidence setup.

This schema PR initially targeted `codex/hours-eval-pr-1023`. PR #2345 merged into `main`, which is now the schema PR's base. The schema diff preserves that dependency and does not modify the hours fixtures or weaken their graders.

## Validation and delivery

The isolated production build passed with `PUBMAX_E2E_KEYLESS=1`, `NEXT_DIST_DIR=.next-schema-prod`, and revision stamps pinned to `local`. The standard restored-build wrapper removed generated bundle changes and restored the TypeScript configuration.

The build served only on `127.0.0.1:6317`. All twelve local HTTP responses returned 200. All twelve canonical URLs retained the production origin. HTTP assertions also checked founder profile ownership, shared Organization and WebSite references, the contact email, and both historic repairs. `after-summary.json` records those routes.

Eleven unique JSON-LD script blocks came directly from those HTTP responses. Schema.org validated the combined snippet with zero errors and zero warnings across fourteen detected items. `schema-validator-after.png` records the result. This combined syntax check does not establish Google rich-result eligibility or replace the identity assertions.

Both independent behavior and standards reviews found no issues. The PR validation receipt records the full repository result on the combined stack. No production application deployment is part of this task.

## Limits

The repair changes markup only. It does not reconcile conflicting historic records or alter generated datasets. It does not invent ratings, prices, opening hours, licenses or business addresses. Schema validity does not guarantee Google rich results.

## References

- [Schema.org sameAs](https://schema.org/sameAs)
- [Google Organization guidance](https://developers.google.com/search/docs/appearance/structured-data/organization)
- [Google structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
