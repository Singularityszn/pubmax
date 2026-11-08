# Voice, copy and the analytics plan

What the documentation governs: how copy reads, and what a number means. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **Live docs and dated records are different.** Live docs are `docs/rules/`, `docs/*.md` without a date in the name, and the area `AGENTS.md` files. A doc with a `2026-MM-DD` date in its name, and everything under `docs/superpowers/`, `docs/handoffs/` and `docs/archive/`, is a record of its day. Never cite it as current behaviour.
- **`docs/VOICE.md` governs copy.** It owns the banned words, the no-em-dash law, British spelling, no exclamation marks and the price disclosure lines. A copy rule is held by a fence over the tree, never by a list of files.
- **Jokes live in empty states, loading lines and the 404.** Never put one beside a figure, a date, a source, a legal term or an accessible name.
- **`lib/analyticsEvents.ts` owns the event names.** `docs/analytics/TRACKING_PLAN.md` owns what each one answers. `docs/analytics/METRICS.md` owns what each number means.
- **An event name lands with its emitter in the same commit.** `__tests__/analyticsEmitterFence.test.ts` refuses a name nothing emits.
- **Filter product queries on `properties.environment = 'production'`, never on `$host`.** Server events carry no host. `lib/analyticsAttribution.mjs` stamps the lane and the build.
- **Two transports share one consent gate.** Named events go through `POST /api/events`. Browser SDK events go through the `/ingest` proxy. Every rate is over consented visitors.
- **No per-plan key or plan id in an event.** It would link two devices to one night.

## Detail

Full rules, pins and history: [`docs/rules/docs-voice-copy-and-analytics.md`](rules/docs-voice-copy-and-analytics.md).
