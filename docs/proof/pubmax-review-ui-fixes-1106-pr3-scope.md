# PR scope amendment

Copy this scope section into the PR body during the PR phase.

## Scope

This PR fixes the design review polish items from findings 5 to 13.
By firstmate decision, finding 1 ships separately from branch `fm/pubmax-review-ui-fixes-1106-nav` in [PR #2563](https://github.com/Singularityszn/pubmax/pull/2563).
The separate PR owns the desktop navigation correction.
Deployment requires the captain's approval.

## Price label evidence

The captain supplied the dessert-wine names from the pub's menu, read on 7 November 2026.
The menu is <https://loreoftheland.com/menu/wine-list/>.
The correction preserves the source spelling "Golzalez" and each recorded price.
The ledger and evidence file carry the complete names and explicit 50ml servings.
The repository builder produces the public bundle from the corrected ledger.

The Social regression test uses the menu names as its independent expected values.
It passes the published rows through `buildSocialAlternatives` and renders `SocialLondonEmpty`.
It rejects truncated names, wrong servings, wrong prices, and missing source links.

## Focused verification

All 35 tests passed across the five focused test files.
These checks cover Social rendering, price selection, source evidence, and ledger reconciliation.
Chromium checked the rendered Tonight components with their stylesheet at 320, 390, 640, 900, and 1280 pixels.
Both source targets remained 44 pixels high and separate from the venue targets.
The lower edge of each venue target still belonged to the venue link.
This check used rendered component HTML, not a complete application session.
The local check script is `artifacts/review-fixes/check-targets.cjs`.
