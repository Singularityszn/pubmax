# Automatic Day and Tonight entry, 25 October 2026

The main Tonight link opens Day from 04:00 until 16:00 on the Europe/London clock.
It opens Tonight from 16:00 across midnight until 04:00.
Every currently selectable city uses this timezone.
The 04:00 boundary follows the existing listings and planner service day.
The greeting clock retains its independent 05:00 morning boundary.

The phone dock, desktop navigation and homepage share the same rule.
Explicit Day and Tonight links keep their destinations.
A clock change updates the main link without redirecting an open page.
No manual preference is stored.
The cached server document keeps a stable Tonight link until hydration.

## Source and browser custody

The integration base is `a87240e748c859556b3604db508db257af96ca03`.
It includes the restored header theme control and native Home launch.
Those features remain present.

The before capture ran the exact integration base on private port 32186.
The after capture ran product commit `449d9b296dfe2c1909be5d611f7d74ecdaf3cba9` on the same port.
Both captures used Chromium 156.0.8078.4, a 390 by 844 viewport, light theme and reduced motion.
The device timezone was America/New_York.
The clock was fixed at `2026-07-15T08:00:00Z`, which is 09:00 in London.
The before link opened `/tonight` and failed the `/today` expectation.
The after link opened `/today` and passed that expectation.
Both servers stopped after their checks.

## Checks

- All 251 focused tests passed after integration.
- All 211 clock, listings and planner tests passed under both New York and Tokyo process timezones.
- All 20 Day/Tonight browser cases passed.
- All 11 existing mobile navigation and filter-sheet browser cases passed.
- Both phone and desktop keyboard theme cases passed.
- Both isolated production builds completed.

The browser cases cover winter and summer cutoffs, midnight, both 2026 clock changes, cached hydration and manual URLs.
They also cover live 04:00 rollover, reload, theme independence and returning simulated iOS and Android launches.
The native checks retain a chosen Glasgow map destination while opening Day from the main link.

Two new rollover fixtures initially tried to pause the clock in the past after page loading advanced it.
The corrected fixtures start two minutes earlier, pause immediately before the boundary, and advance one second.
The product code did not change for that fixture correction.

Local receipts and screenshot pairs are under `artifacts/day-tonight-completion/` in the task worktree.
The full `npm run verify` receipt and hosted checks are separate from these focused results.
The publication pipeline must validate the final head before it publishes the PR.

## Limits

The browser runs used local keyless data and simulated native bridges.
They do not prove an installed app or physical-device behaviour.
The static Tonight fallback remains for JavaScript-disabled and pre-hydration clicks.
No production deployment, migration, paid provider call or real account change occurred.
