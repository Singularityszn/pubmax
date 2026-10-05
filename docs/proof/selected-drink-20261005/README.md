# Selected-drink planning proof, 5 October 2026

A Gin request from a Wine map generated two Gin stops, but activation retained Wine and pint prices. An Alcohol-free request also retained Beer. The corrected map adopts the generated drink and clears incompatible brand and style selections.

These are real local production pages at 390 x 844. The generation POST, venue data, route activation and rendered assets ran through the original keyless Playwright server. No HTML or generation response was fulfilled by a fixture.

| Journey | Before | After |
| --- | --- | --- |
| Wine map, then Gin in Soho | ![The old map retains Wine and pint money](gin-before.png) | ![The corrected map shows Gin and missing Gin prices](gin-after.png) |
| Gin map, then Alcohol-free in Soho | ![The old map retains Beer](alcohol-free-before.png) | ![The corrected map shows Alcohol-free and missing drink prices](alcohol-free-after.png) |

The same production build passed all eleven selected-drink browser cases with the original two workers and no retries. The cases cover Beer, Wine and Gin sharing and reopening, four phone defaults and overrides, unsupported brand refusal, generated Gin calendar export and reopen, and generated Alcohol-free and Beer activation. The Beer share link explicitly preserves `drink=beer`. Four unchanged mobile planner, stop-pill and food/no-alcohol journeys also passed. Five focused unit files passed 260 cases. Types and scoped lint passed.

Two further connected repairs preserve the generated result when its form moves within the planner and hydrate priced slim stops that lack a pint identity. Existing stop ceilings, settled-readiness checks and attempted-request exclusions remain intact. Earlier failing runs remain in private evidence.

The following 1440 x 900 capture shows the Wine route's selected-drink title and unknown round total. Its loading map does not establish map readiness or pin performance.

![Desktop Wine route shows unknown total and Wine stops](wine-desktop.png)

These results establish local keyless behaviour. They do not establish hosted Auth or Storage, live voice, private GPS, Core Web Vitals, production deployment or every route. The original full merge gate and Native review must complete before publication. This is a dated record, not a claim about the deployed website.
