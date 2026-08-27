# Live Map recovery proof

Source SHA: `1de8c82f40abf9050ff936de96b79101fab62cf1`

Route: `http://localhost:3017/map`

Browser: Codex in-app browser. One `next dev` server on port 3017.

## 390x844

- Fresh First Visit owns focus. Primary tab navigation is hidden with `visibility: hidden` and `pointer-events: none`.
- Initial visible controls are at least 44px high. Document horizontal overflow is 0px.
- After First Visit closes, Near me is the only Map edge action.
- Default Pints has no resting phone chip.
- More > Prices exposes Drinks controls. More > Transit exposes current TfL status.
- Search and Map controls close with Escape and return focus to their opening control.
- UK Base reached `ready` with 2,348 visible rows in the observed viewport.
- Browser console contained no warning or error entries.

## 1440x900

- Normal Map entry rendered curated Venue Dataset pins and the separate UK Base layer.
- UK Base reached `ready` with 2,506 visible rows in the observed viewport.
- Document horizontal overflow is 0px.
- Visible Zoom in, Zoom out, Drinks, Plan, and Layers actions meet the 44px target floor.
- One visible Zoom out action changed UK Base to `zoom_required` with a zero row count.
- Browser console contained no warning or error entries.

## Runtime result

Malformed local Supabase settings now degrade to keyless operation. Pint Drops, CityMCP, What's On, Tonight conditions, area news, and provisional UK Base price requests returned HTTP 200 during this run. The earlier invalid Supabase URL error and production rate-limit secret failures did not recur.

## Limits

- This is development-server proof, not production performance evidence. First compilation took about 17 seconds and some images include the Next.js development control.
- Browser Back was not separately exercised before the authorised server stopped. Escape and focus return were verified. Existing Back contracts were not rerun in this proof-only gate.
- Desktop keeps its explicit `Drink: Pints` toolbar control. The removed resting Pints chip is the phone chrome contract.
- Venue selection, Plan completion, signed-in flows, and release deployment remain outside this bounded proof.

## Files

- `mobile-390-first-visit.jpg`
- `mobile-390-map-ready.jpg`
- `mobile-390-drinks.jpg`
- `mobile-390-transit.jpg`
- `desktop-1440-map-ready.jpg`
- `desktop-1440-zoom-required.jpg`
