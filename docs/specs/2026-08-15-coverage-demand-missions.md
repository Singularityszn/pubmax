# Coverage Demand Missions

## Goal

Turn unsupported-area requests into a ranked admin mission queue without exposing contact details or location data.

## Product contract

- Aggregate demand by normalised area and matched patch.
- Rank higher signal counts first. Use latest activity as the tie-break.
- Show signal count, source counts, first seen, and last seen.
- Default to the last 90 days. Allow a bounded time window and result limit.
- Mark a result partial when the durable read reaches its safety cap.
- Keep email and raw location data outside the summary type, query, API response, and admin UI.
- Use the existing admin session. No new credential or public read path is allowed.
- Fail soft to an empty summary on store read failure. Never report failed reads as real zero demand in the UI.

## Store contract

- `AreaDemandStore.listSummary({ limit, sinceDays })` owns aggregation for both memory and Supabase backends.
- Source counts use the closed `AreaDemandSource` vocabulary.
- A summary key combines `areaKey` and `matchedPatchId`. This keeps changed or unmatched coverage mappings visible.
- The durable reader selects only area, patch, source, and time fields.

## Admin contract

- `GET /api/admin/area-demand` requires the existing moderator session.
- Response carries `summary`, `partial`, `sinceDays`, and read `status` only.
- Admin has one `Coverage demand` tab with one load action and responsive cards.
- Empty, denied, and failed states remain distinct.

## Verification

- Store tests cover aggregation, ordering, time windows, limits, sources, and both backends.
- Route tests cover moderator access, query bounds, PII exclusion, and read failure status.
- Component tests pin the admin tab and privacy-safe queue contract.
