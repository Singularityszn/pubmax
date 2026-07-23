# Color v2 + dark map plan (owner-approved direction, 2026-07-22)

Owner brief: colors for both themes should reach the Linear / x.com bar; the dark map is far worse than light and must be fixed; app icon becomes white tile + coral double-struck X.

## Wave A: dark basemap overhaul (first)
Problem: dark theme kept light mode's road-darker-than-ground relationship, so roads vanish. Fix in lib/mapBasemapTaste.ts dark palette (html-level tokens only; components/map/** untouched, owned by the area-button lane):
- Ground near-black; buildings one visible luminance step up; roads become the LIGHTEST strokes (majors brighter, minors subtle); water deep slate-blue; greenspace dark desaturated green; labels brighter with halos.
- Acceptance: Fable's live screenshot loop; dark map must read as well as light. Before/after shots to owner.

## Wave B: color token v2, both themes (after A)
- Structural neutrals: borders/dividers/muted text move to disciplined neutrals in both themes; warm ink stays for identity surfaces.
- Light mode elevation ladder (page vs card vs overlay whites are currently near-identical).
- Full text ramp AA audit both themes; coral = action/identity only, never structure.

## Wave C: brand surface alignment (parallel)
- Icons regenerated: white rounded tile, coral double-struck X (owner-picked), all sizes + favicon + maskable + apple-touch; splash + theme_color meta aligned; store-asset masters (issue #440 follow-up) ported.
