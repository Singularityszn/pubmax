# Area news context and stacking proof

This is a dated local production-build record. It does not establish deployment or production-site behaviour.

The before build used `d69cd6083e8d81d57d56075e35a431efb804a026` on port 3412. The after build used that base plus this change on port 3413. Both used isolated Next.js output directories and keyless local configuration.

The live status feed no longer contains the reported Kingston headline. Fresh browser reproduction showed "Gas cylinder fire under Bermondsey railway arches" on a central London route. The API assigned that signal to Bermondsey and Silwood Street. The same context defect therefore remained reproducible with current data.

The correction filters area signals before choosing a headline or grouping the expanded feed. It uses the existing settled map label and established place-name normalisation. Local news can appear after choosing its area. City-wide fallback retains its existing camera-movement gate. Route panels and strict modal scrims stack above the news.

## Real feed, before and after

The screenshots use the same central route with Friend At Hand and The Sir Christopher Hatton. Desktop before shots show unrelated Bermondsey news. Desktop after shots omit it. Phone shots preserve the existing map design, which does not mount this desktop toast.

| Viewport and theme | Before | After |
| --- | --- | --- |
| 1440 × 900, light | [Before](before-real-1440x900x1-light.png) | [After](after-real-1440x900x1-light.png) |
| 1440 × 900, dark | [Before](before-real-1440x900x1-dark.png) | [After](after-real-1440x900x1-dark.png) |
| 390 × 844, light | [Before](before-real-390x844x1-light.png) | [After](after-real-390x844x1-light.png) |
| 390 × 844, dark | [Before](before-real-390x844x1-dark.png) | [After](after-real-390x844x1-dark.png) |

The real product search selected "Bermondsey & London Bridge". [Useful local news remains visible there](after-real-1440-dark-bermondsey.png).

## Named regression and interactions

The browser tests supply the exact reported Kingston headline at the public status API boundary. They exercise the production map with real venues and routes. No provider write occurs.

Each theme and viewport checks unrelated initial context, Kingston selected through the visible area picker, a clickable route stop, a strict command-palette modal, a different route, and a fresh map visit. Desktop checks require the toast to exist before testing pointer blocking. The modal also retains keyboard focus and closes with Escape. Phone checks preserve the existing absence of this toast.

The earlier storage-only restore setup conflicted with saved viewport priority. The final test selects the real locality through "This area", searches Kingston, and clicks "Kingston upon Thames". The earlier failed setup remains in the raw task evidence.

The final production browser matrix passed all four journeys in 57.4 seconds. It verifies the rendered theme and captures the route stop after scrolling it into view. The fresh visit follows an explicit Soho selection, so its expected context is unrelated to Kingston.

| Fixture proof | Light | Dark |
| --- | --- | --- |
| Route editor with relevant news | [Route stops](fixture-1440-light-route-editor.png) | [Route stops](fixture-1440-dark-route-editor.png) |
| Strict modal above relevant news | [Modal](fixture-1440-light-modal.png) | [Modal](fixture-1440-dark-modal.png) |

The rendered component tests cover area changes, expansion reset, borough aliases, combined map labels, unrelated and unlocated signals, source links, Escape, city-wide alerts, and TfL fallback.

Raw API responses, viewport/theme measurements, source hashes, build logs, test logs, and screenshots are retained in the task's evidence directory. Early screenshots taken before viewport emulation was verified are superseded by the `before-real` and `after-real` files above.

## Repository gates

`npm run verify:no-mistakes` passed. It runs the full repository verification with committed-data protection. Coverage passed 21,431 tests. The disposable database suite passed 554 tests. ESLint reported no errors and 85 existing warnings. The freshness gate passed with three store feeds explicitly unmeasured in this keyless runtime.

The focused toast suites passed 21 tests. The first component regression failed before the correction. The original production browser check also failed because local news disappeared when an area was restored. Neither failure was removed by silencing useful news.
