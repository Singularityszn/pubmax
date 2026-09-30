# Selected historical source preservation, 29 September 2026

21 selected working source versions are preserved in `reviewed-source.zip`. Every entry exactly matches its inspected working file. This archive is historical source, not executable app code or a tested product recovery. It contains no chat exports, browser traces, downloaded packs, build output or environment files.

## Outcomes for the 24 older source and document candidates

| Candidate | Outcome |
| --- | --- |
| 16 harvest source and test files | Exact working versions archived. Their shared guarded transport depends on unmerged changes missing from current main. The old patch refuses to apply to main. No historical crawler is run or declared fixed. |
| Two dependency tooling files | Old version bumps are superseded by the maintenance lane, which owns current compatible upgrades and its regenerated lockfile. Their source hashes remain in the local audit manifest. |
| One skip-link E2E file | Exact working version archived, including the no-JavaScript landmark focus case. Current main does not contain that case. Runtime acceptance is separate from retention. |
| One native-onboarding E2E file | Exact working version archived. Historical native startup proof is inconclusive and is retained locally. No native release is cleared. |
| Three review-dedup prototype files | Exact working versions archived. This advisory prototype is not added to the live review pipeline. |
| One old product-audit document | Retained locally. It contains dated acceptance claims and links into private browser proof; replacing the current audit with it would misstate release status. |

Active v0 work stays with its current owner. Its 79 earlier unmatched source versions are excluded from this snapshot while the owner continues implementation. Standalone proof folders and detached branches stay local until their content and dependencies are reconciled. Negative remote matches remain bounded evidence, not proof of lost work.

## Archive manifest

Paths inside the archive are relative names grouped by original task. No absolute local paths are stored. SHA-256 checks below were recomputed from the archive after creation.

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `harvest/__tests__/commonRefresh.test.ts` | 22238 | `ca5ad0f37bf3710b0b2dec0e07fe1b3f116e369795389de362083c4d7aa3483e` |
| `harvest/__tests__/editorialPoll.test.ts` | 10524 | `0de338316098160930ff76f89a0d1d57a6a98e48490235051780d663c164fcc1` |
| `harvest/__tests__/spoonsValueImport.test.ts` | 8066 | `df4c1f38e913327ac3ab3998ae1b8d72a315b715efc4dec5905cd8bc91570a75` |
| `harvest/scripts/editorial/poll.mjs` | 6417 | `6adeece273653235f86e3a5bb20643d9e7afc38fefc9f03a51476e9c73b57339` |
| `harvest/scripts/fetch_wetherspoons_pubs.mjs` | 14485 | `df33bcffbb45944bdbcbd8f06ee4c34bbaa90629fbf1e73bcdf9f7cf5ae388cc` |
| `harvest/scripts/harvest_chain_menu_prices.mjs` | 11469 | `4126df38ed69082f72374ad3737a834c9240c144fa79f778e82536090fb63c49` |
| `harvest/scripts/refresh_drink_prices.mjs` | 24088 | `087c77c1131eb7156113a36fe3970dd59a80efbf1b1255f77f229db51a0447b7` |
| `harvest/scripts/refresh_pint_price_observations.mjs` | 19457 | `c982a45447a6a6c0ab7fcb9383b339a40221c548d983e380b802cd64cf440707` |
| `harvest/scripts/spoonme/import-report.d.mts` | 2333 | `350dcbe48bebe87d084a3b2647ace3c5073e98cae06392091e73da4bcb823b4a` |
| `harvest/scripts/spoonme/import-report.mjs` | 19249 | `7acf19a3aa1664762a27c791253037c33d35f8f923e2ed740f7ad3cc0a87832a` |
| `harvest/scripts/whatson/commonRefresh.mjs` | 17644 | `fee9fdc616b3c60e1438d1ffb6c77c68c9877b4e61c5498494cfe0a0a65771de` |
| `harvest/scripts/whatson/quizRefresh.mjs` | 8271 | `23ccdc0381dad78dcbe40e4826bfe3989901795eb58215b443218f576e185c66` |
| `harvest/scripts/whatson/scrape_greene_king_sport.mjs` | 7644 | `119d62526d9c1276c154d1ed47351bef58c4f317f74101b6511eebdf96c50faf` |
| `harvest/__tests__/harvestCallerFollowup.test.ts` | 4610 | `f2d93ee54804c6420bcf1445f36f258f2e22f3f7f12404f8c986087b6784dd16` |
| `harvest/scripts/lib/harvestCallerTransport.d.mts` | 494 | `54b1fd3227b2c3eb768f15d2586387e7cfb69f641843eed30c99a778e03a80e2` |
| `harvest/scripts/lib/harvestCallerTransport.mjs` | 1768 | `520f05938679a380199c42df2e49db718ca31d6b9110fa81a8f734935405710e` |
| `skip-link/e2e/landmark-and-sheet.spec.ts` | 16238 | `0acb3eb00781dde95a7227d6d27fad9e5c03514b90d313e78ac1b06a890f88e1` |
| `native-onboarding/e2e/native-onboarding-actions.spec.ts` | 5983 | `791dd9ad291f0d4923859814519514cd5f6f713f1d24b51d29c6e303c97baac1` |
| `review-prototype/__tests__/reviewFindingDedup.test.mjs` | 6022 | `e545e74f38694086a651e49ba8133900ca290354445b71baeed1787a5c340147` |
| `review-prototype/docs/agents/review-finding-dedup.md` | 2526 | `1622c66e18a22b54f57d9f2ff14606480a8f55f3e77df99531217e7ce418f39b` |
| `review-prototype/scripts/review-finding-dedup.mjs` | 9488 | `cf7594b3893d85d35ebeb9f03cef80510d95049a1b94a1d342529aec9ccebee9` |

## Restore safely

Extract a selected group into a fresh scratch directory, inspect the source against the current owning modules, and transplant only the current intended behaviour. Never extract over a live agent checkout. The archive does not include a complete runnable historical dependency tree. Use the app's normal checks before integrating recovered code.

This report and archive are prepared for reviewed GitHub preservation. A local archive alone is not remote storage. The publication receipt belongs in the completion report once the no-mistakes gate returns a confirmed branch or PR.
