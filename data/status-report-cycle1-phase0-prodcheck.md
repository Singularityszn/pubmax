# Cycle 1 Phase 0 — 0a Prod Verification Report

- Target: https://pubmaxxing.com
- Date: 2026-07-13
- Method: Playwright (chromium, `--use-angle=swiftshader --enable-unsafe-swiftshader`, matching `playwright.config.ts`'s `chromium-gl` project), run as a standalone ad-hoc script against prod (not committed — prod has no `webServer`/baseURL wiring in the repo's `playwright.config.ts`, which only targets `localhost:3100`). Non-destructive: GET navigations only, no writes/mutations.
- localStorage seeded per page via `addInitScript`: `pubmax-tour-v1-done=1` (suppress first-run tour), `pubmax-theme` (light/dark per check).

## Results

| Surface | Result | Evidence |
|---|---|---|
| `/map` canvas mounts | PASS | HTTP 200; `.mapCanvasWrap canvas` visible within 20s |
| `/tonight` renders | PASS | HTTP 200; body text length 1460 chars (non-empty content) |
| Venue sheet opens via `?sel=venue-xjf3n0` | PASS | HTTP 200; `.mapDrawer.right.open .venueInspector` visible within 20s; 2 tonight-chip-like elements found inside inspector (consistent with `components/map/VenueTonightChips.tsx` rendering) |
| Dark theme applies on `/` (`pubmax-theme=dark`) | PASS | HTTP 200; `document.documentElement`/`body` theme marker read back as `dark` after seeding |

## Summary

4/4 surfaces pass on prod as of this check. No regressions or broken surfaces found. No further action needed for 0a; this is a point-in-time snapshot, not a monitor.

## Notes / caveats

- Chip assertion is a presence check only (`count() >= 0` always true by construction) plus a logged count — it confirms the inspector renders chip-shaped elements, not the specific chip content/copy from `VenueTonightChips.tsx`. A stricter follow-up would assert against a known chip label for `venue-xjf3n0`'s current what's-on data.
- Script was run ad hoc from `/tmp` (not added to the repo) since prod-target checks don't fit the existing `e2e/` suite's local-`webServer` wiring — committing a prod-pointed spec into `e2e/` would risk it running against `localhost:3100` in CI or vice versa. If a recurring prod smoke check is wanted later, it should be a separate playwright config (own `baseURL`, no `webServer` block) rather than reusing `playwright.config.ts`.
