# CityMCP London integration

**Endpoint:** `https://citymcp.com/london/mcp` (Streamable HTTP / SSE, keyless)
**Transport:** POST JSON-RPC, `Accept: application/json, text/event-stream`
**Tools:** `search_places`, `get_place`, `get_area`, `get_journey`, `city_status`, `things_to_do`

CityMCP London is our authoritative source for London-local, "right now"
facts: weather, TfL disruptions, event/protest/strike signals, and thin
Google-Places venue rows for name-based lookups. It's Server-Sent-Events
under the hood, and every response is a single JSON-RPC envelope on one
`event: message` frame — see `parseSseJsonRpcBody` in `lib/citymcp/client.ts`.

## Cursor MCP reload

The MCP config lives at `.cursor/mcp.json` (project-scoped, gitignored):

```json
{
  "mcpServers": {
    "citymcp-london": { "url": "https://citymcp.com/london/mcp" }
  }
}
```

To pick up config changes in Cursor:

1. Open the command palette → **"Reload MCP Servers"** (or **"Restart MCP Server: citymcp-london"** for just this one).
2. Confirm the server appears in the MCP panel with `initialize`, `tools/list`
   showing the six tools above.
3. If the server errors out, re-check the URL and that your network can reach
   `citymcp.com` (no auth required).

## Runtime API surfaces (app-facing)

The app never calls CityMCP from the browser directly; it goes through
server-only routes so the SSE handshake stays on Node and no secrets/UA rules
leak into the client.

- **`lib/citymcp/client.ts`** — server-only MCP client. Public helpers:
  - `callCityMcpTool(name, args, opts?)` — generic `tools/call` with typed
    JSON-RPC error handling (`CityMcpError`).
  - `fetchCityStatus({ borough? }, opts?)` — cached (~5 min in-process) wrapper
    around `city_status`. Cache is per-borough; use `resetCityStatusCache()`
    in tests.
  - `searchCityPlaces(query, opts?)` — `search_places` with optional `limit`,
    `near`, `openNow`, `minRating`, `maxPrice`, `sort`.
- **`GET /api/citymcp/status`** — returns `{ asOf, weather?, tubeLines?, signals[] }`
  trimmed for UI: tube "Good Service" lines are dropped, and signals are capped
  to the top 6 by severity (major > notable > info). Always fail-soft: any
  upstream failure returns 200 with `{ error, signals: [] }`.
- **`GET /api/citymcp/places?q=...&limit=5`** — thin place rows for
  `search_places`. Validates `q` (non-empty, ≤ 200 chars) and returns 400
  otherwise; upstream failures fail-soft to 200 with `{ places: [], error }`.
- **`components/map/CityStatusBanner.tsx`** — the London-only strip that
  fetches `/api/citymcp/status` on mount and shows one compact headline
  (top signal → tube summary → weather). Only renders when `cityId === "london"`.

## What NOT to rebuild

- **Last-train / "last pint" decisions:** we already own this at
  `GET /api/last-train` (TfL Unified API, live Arrivals + timetable fallback,
  disruption summary, nearest-station geo). CityMCP `get_journey` and
  `city_status.tubeLines` are complementary; do not use them to replace the
  TfL-native last-train pipeline.
- **Static venue index / prices / hygiene badges:** the PubMaxing dataset in
  `data/` and `lib/venuePriceIndex.ts` remains the source of truth for names,
  cheapest price bands, and curated crawls. Use `get_place` (`deep: true`)
  only for opt-in enrichment on specific venues — do not fabricate hygiene
  scores or Order URLs in the UI.
- **City chooser / nearestCity / preferred city:** those are entirely local
  logic (`lib/cities.ts`, `lib/nearestCity.ts`), unrelated to CityMCP.

## Upstream quirks

- The server returns `text/event-stream` for `initialize`, `tools/list`, and
  `tools/call`, and `202` (no body) for `notifications/initialized`. We only
  send `tools/call` — no explicit `initialize` handshake — which the server
  accepts fine per the probe run.
- No `mcp-session-id` header is emitted on any response, so subsequent calls
  do not need to echo one back.
- `tubeLines[].status` values seen so far: `Good Service`, `Minor Delays`,
  `Part Closure`, `Planned Closure`. `disruption` is a free-form string, often
  multi-sentence — the UI truncates to a single line.
- `signals[].severity` values seen: `info`, `notable`, `major`. Anything else
  should be treated as lowest priority (`trimSignals` handles this).

## Local smoke-test

```bash
# Status
curl -s http://localhost:3000/api/citymcp/status | jq .

# Search places
curl -s "http://localhost:3000/api/citymcp/places?q=The%20George%20Southwark&limit=3" | jq .
```

Then open the London map (`/map` with London selected) and confirm the status
strip renders below the toolbar. On upstream failure the strip should stay
hidden — never a red error state.

## Related tests

- `__tests__/citymcpClient.test.ts` — SSE parser, `trimSignals`, generic
  `tools/call` behaviour, city_status cache, `search_places` filters.
- `__tests__/citymcpStatusRoute.test.ts` — status route validation,
  trimming, fail-soft.
- `__tests__/citymcpPlacesRoute.test.ts` — places route validation,
  thin-row shape, fail-soft.
