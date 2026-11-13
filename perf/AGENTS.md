# Speed budgets and measured findings

Measured speed: the page and API ceilings, the Core Web Vitals baseline and the findings behind them. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **A ceiling comes down, never up.** A ceiling follows the measured figure down at the next sweep. Raising one needs the commit that needs it, the reason, the measured figure and the captain's word. Route ceilings are in `perf/route-budgets.json`.
- **A route the sitemap advertises carries a budget.** A redirecting route is measured as a redirect.
- **A verdict is unanimous.** A ceiling that the samples do not decide is reported as undecided rather than failed.
- **Compare against the merge base.** A slow box and a slow route look the same in a breach table, so the job measures the merge base beside the change.
- **Until the pins paint, the network belongs to the pins.** A surface asks for a city-wide pack only when it is about to draw it.
- **The root shell reads leaves, never libraries.**
- **A phone map draws at two pixels per point.** Three is nine times the shading.
- **A tab is warmed on intent, not on idle.** An idle warm was measured and bought nothing.
- **A hydration remount is a new largest paint.** Remount only when there is something to recover.

## Detail

Full rules, measured figures, pins and history: [`docs/rules/perf-budgets-and-measured-findings.md`](../docs/rules/perf-budgets-and-measured-findings.md).
