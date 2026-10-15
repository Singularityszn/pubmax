# Map load timing in the field

`map_load_timing` is one browser SDK event per map visit. It reports how long real
visitors wait for pins, so the owner's p99 time-to-pins comes from the field and not
only from the local rig in `docs/PERFORMANCE_BUDGETS.md`.

- **Shape and sanitizer:** `lib/mapLoadTimingEvent.ts`. `before_send`
  (`sanitizePosthogEvent` in `lib/posthogClient.ts`) rebuilds it from that closed shape.
- **Reporter:** `lib/mapLoadTiming.ts`, started once per `PubMap` mount by
  `components/map/useMapLoadTiming.ts`.
- **Transport:** the PostHog browser SDK through the first-party `/ingest` proxy. It
  needs no new vendor and adds no request before the pins paint.
- **Consent:** the shared gate in `lib/analytics.ts`, Do-Not-Track included. Every
  figure below is over CONSENTED visitors only.
- **Fence:** `__tests__/mapLoadTiming.test.ts`.

## Outcomes

Each visit ends in exactly one outcome.

| `outcome` | When |
| --- | --- |
| `painted` | The pin layers first became visible (`pubmax:pins-visible`). |
| `timeout` | The pins had not painted 30 s (`MAP_LOAD_TIMEOUT_MS`) after the map's first render. |
| `abandoned` | The page was hidden for good (`pagehide`, sent by beacon) or the map unmounted before the pins painted or timed out. |

## Properties

Every `*_ms` value is milliseconds from navigation start, the same clock as the local
`pubmax:*` marks. A milestone is the first mark at or after this visit's first render,
so an in-app return to the map does not reuse an earlier visit's marks.

| Property | Meaning |
| --- | --- |
| `map_constructed_ms`, `scene_built_ms`, `first_pins_ms`, `pins_visible_ms` | The milestones. `pins_visible_ms` is present only on `painted`. |
| `mount_ms` | When the map first rendered. It is about 0 after a cold landing and larger after an in-app navigation. |
| `elapsed_ms` | When the outcome was recorded. |
| `landed_on_map` | The document's own navigation was to this page. Filter on it for cold time-to-pins. |
| `nav_type` | `navigate`, `reload`, `back_forward`, `prerender` or `unknown`. |
| `sw_controlled` | A service worker controlled the page when the map rendered. |
| `returning_visit` | This browser had painted first pins before. |
| `hidden_before_pins` | The tab was hidden at some point before the outcome. Background tabs do not paint, so exclude these from the tail. |
| `device_class` | `phone` (under 600 px), `tablet` (under 1024 px) or `desktop`, by viewport width. |
| `mobile` | `userAgentData.mobile`, or a coarse pointer where that is missing. |
| `viewport_width`, `viewport_height` | Integer CSS pixels. |
| `effective_type`, `save_data` | Network Information API values, `unknown` where it is missing. |
| `device_memory`, `hardware_concurrency` | Present only where the browser exposes them. |
| `venue_count` | The venues the map held when the outcome was recorded. |
| `surface` | The coarse pageview surface (for example `/map`), or `other`. |

## Saved query: p50, p95 and p99 by device class

HogQL. Run it through `POST /api/projects/:project_id/query/` with
`{"query": {"kind": "HogQLQuery", "query": "<the SQL below>"}}`, or save it as a SQL
insight.

```sql
SELECT
    properties.device_class AS device_class,
    count() AS visits,
    round(countIf(properties.outcome = 'timeout') / count(), 4) AS timeout_rate,
    round(countIf(properties.outcome = 'abandoned') / count(), 4) AS abandoned_rate,
    quantileIf(0.50)(ttp_ms, properties.outcome != 'abandoned') AS p50_ms,
    quantileIf(0.95)(ttp_ms, properties.outcome != 'abandoned') AS p95_ms,
    quantileIf(0.99)(ttp_ms, properties.outcome != 'abandoned') AS p99_ms
FROM (
    SELECT
        properties,
        if(properties.outcome = 'painted',
           toFloat(properties.pins_visible_ms),
           toFloat(properties.elapsed_ms)) AS ttp_ms
    FROM events
    WHERE event = 'map_load_timing'
      AND timestamp >= now() - INTERVAL 7 DAY
      AND properties.environment = 'production'
      AND toString(properties.landed_on_map) = 'true'
      AND toString(properties.hidden_before_pins) = 'false'
)
GROUP BY device_class
ORDER BY device_class
```

Four things about the query that are easy to get wrong.

- **A timeout is in the percentile, not left out.** It counts at its `elapsed_ms`,
  which is a floor of about 30 s, so a p99 near 30,000 ms means the slowest visits
  never painted. Leaving timeouts out would hide exactly the tail this event exists
  to show.
- **Abandoned visits are a rate, not a time.** The visitor left before the pins, so
  how long the pins would have taken is unknown. They stay in `visits` and
  `abandoned_rate` and are kept out of the percentiles only. A rising rate with steady
  percentiles is still a slower map.
- **The rate is a floor.** An abandoned visit rides the PostHog SDK, so a visitor who
  leaves before that SDK has loaded (a very slow first load, or consent granted
  moments before leaving) sends nothing.
- **Cold landings only.** `landed_on_map` keeps visits whose document opened on the
  map. For in-app returns, drop that filter and read `ttp_ms - mount_ms`.
  Split further by `nav_type`, `sw_controlled` or `effective_type` with the same
  `GROUP BY`.
