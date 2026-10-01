# R21 issue acceptance reconciliation

30 September 2026, 09:29 UTC. Read-only GitHub issue bodies via `gh-axi issue view --full` and current source. No browser, test, build, install, index, application edit or issue mutation. This supplements the historical title-only R19 audit; it does not certify completion.

## #1639 concerns accessibility qualification

[Issue 1639](https://github.com/Singularityszn/pubmax/issues/1639) concerns `accessibilityFilterSummary` in `lib/venueAccessibility.ts`, not the pint-price cap. Unknown accessibility facts fail the relevant predicate. The summary says only confirmed venues are shown and gives the count; it does not say other venues may qualify but remain unchecked. `ControlRail` already says unknown pubs are hidden rather than guessed. That is a distinct statement from unchecked venues potentially qualifying.

Acceptance: decide the wording through `docs/VOICE.md`, put any accepted qualification in the existing shared summary for all narrowing facets, and fence the decision. Do not revive the deleted unused `hardConstraintNotice`. Existing summary tests cover confirmed counts and facet grammar; they do not cover the unchecked-venue qualification. Native phone/desktop reproduction and layout remain pending.

The price-cap legend mismatch recorded in R19/R20 is a separate finding. Fixing that text cannot close #1639.

## #1641 requires bounded query intent warming

[Issue 1641](https://github.com/Singularityszn/pubmax/issues/1641) confirms fragments should be removed while queries survive. `/social?tab=discover` and later `/social?feed=nearby` must each warm their own destination.

Keeping the query alone is insufficient. Acceptance also requires a stated bound with a test for the dedupe set, plus measured before/after prefetch counts on mobile tabs and landing calls to action. Current `warmNavRoute` receives a default module set; `IntentLink` passes its own module set. Any bound must apply at the shared owner to the actual passed set as well as the default. Preserve best-effort retry after throws, fragment scrolling and no automatic viewport warming. Derive pathname separately for map detection: simply retaining the query would make the existing full-string equality miss `/map?…`. The default helper set, IntentLink set and MobileTabBar set all need the same bound. Landing warm handlers depend on a preferred city; measure both the unset and selected-city states. Do not add a cache framework merely to cap this existing set. Real production intent/RSC and navigation proof remain pending.

## #1646 requires rendered before/after and cold-route timing

[Issue 1646](https://github.com/Singularityszn/pubmax/issues/1646) deliberately separated canonical detail convergence from the earlier failed-read memoization fix because the artifact owner adds menu enrichment, famous seeds and harvest overlays. Content differences must be explicit.

Acceptance: both Bar Tab and Ledger read `lookupVenueDetail`; remove their local result/read owners; preserve existing missing and unavailable surfaces and retry failed/missing reads. Adapt the existing unavailable/recovery test. Capture before/after header, price rows and photo wall for both surfaces at 390, 768 and 1440, identifying every content difference. Record cold-process timing for both routes. The OG read is a related source lead, but does not replace either page's acceptance. Source convergence alone is insufficient. Canonical aliases, Ledger viewer capability, public drops and no-cache failure behavior remain constraints.

## Scope retained

These issues remain uncompleted. No public endpoint retirement follows from absent in-tree callers. No budget, account, production database or deployment permission changes follow from this reconciliation.
