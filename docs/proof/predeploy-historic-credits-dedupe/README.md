# /historic credits link: one rule, not two

Captured 17 Oct 2026 on local production builds (`NEXT_DIST_DIR=.next-prod`) of
main at `00a10ce3f` (before) and this branch (after), at 390x844, light and dark.

`app/historic/historic.css` carried two `.historicCreditsLink` rules: one from
#2172 (carried to main by #2134) and one from #2173. The later rule won the
colour (`inherit`) and the underline offset (2px); the earlier one still added
`min-width: 44px` and `font-weight: 600`. This branch keeps #2173's rule, folds
those two declarations into it and deletes the other block, so the page renders
exactly as it did.

| Evidence | Result |
| --- | --- |
| `computed-before.json` vs `computed-after.json` | identical (colour, weight, min sizes, display, offset, box) |
| `*-before.png` vs `*-after.png` (8 shots) | byte-identical |
| `e2e/phone-tap-targets.spec.ts -g historic` on the after build | 2/2 pass |

`/historic/<pub>` loads `historic-detail.css`, not this file (its link reads
`min-width: 0px` before and after), so the detail shots are a control.
