# Review follow-up proof

Two PR comments exposed gaps in the first candidate.

- [Indexed venue ranking](https://github.com/Singularityszn/pubmax/pull/2339#discussion_r4360243026): an exact indexed result followed a weaker loaded match. The corrected current-city group shares ranking and keyboard order. Its index retains supported pub pint prices before limiting results. Other drink modes retain their tie order.
- [Per-row source dates](https://github.com/Singularityszn/pubmax/pull/2339#discussion_r4360243042): a publisher aggregate supplied another row’s missing or invalid source date. Each participating row must now have check evidence. An event start remains separate.

The before captures use the local production build of `5120c11deb67a014ba99e9822bed9edfcde90351`.
The after captures use the working follow-up through the actual local Next.js app.
They use browser fixtures at 1280×800 and 390×844. They are not hosted or physical-device proof.
The search fixture stores one exact-match pub in the existing browser index cache. Loaded pubs still come through the map’s normal data path.
The source fixture supplies two unmatched dated events from one publisher. One has an invalid source-check date. Neither event is described as undated.

## Captures

| Case | Before | After |
| --- | --- | --- |
| Indexed search, 1280 | [Before](review-indexed-before-1280.png) | [After](review-indexed-after-1280.png) |
| Indexed search, 390 | [Before](review-indexed-before-390.png) | [After](review-indexed-after-390.png) |
| Source date, 1280 | [Before](review-source-before-1280.png) | [After](review-source-after-1280.png) |
| Source date, 390 | [Before](review-source-before-390.png) | [After](review-source-after-390.png) |

Four date regression cases and two rendered search-order cases failed before the fixes.
The corrected targeted suite passed 154 tests. The six Tonight browser cases and two indexed-search browser cases passed.
The final commit, full verification and production comparison are recorded in the PR’s current validation receipt.
