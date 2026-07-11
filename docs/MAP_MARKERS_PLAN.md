# Map Markers Plan — Drink Icons Dominate

**Branch:** `cursor/nights-out-ui-fdb7`  
**Skills:** use product register under `skills/` (Impeccable / Layers); do not invent a London MCP.

---

## 1. Problem diagnosis

At default London zoom (~9.85), MapLibre clustering (`clusterRadius: 46`, `clusterMaxZoom: 13` in `PubMapCanvas`) collapses almost every pub into large green → amber → brass density circles. Unclustered pubs **already** render drink silhouettes (pint / wine / cocktail / spirits) from `lib/mapIcons.ts`, but users rarely see them — only oversized bubbles.

On Discover, ranked lists (city rivalry, tonight, top-rated) use bold red/brass rank circles (`.leaderboardRankNum`, `.tonightRank`, `.topRatedRank`) that compete with content.

Champagne maps to the **wine** drink-pin kind (no separate champagne glyph).

---

## 2. Visual changes

| Surface | Change |
|--------|--------|
| **Clusters** | Shrink `circle-radius` / text size; mute opacity/blur so clusters read as small density hints, not price traffic lights. Prefer tighter `clusterRadius` and/or lower `clusterMaxZoom` so drink icons appear earlier when zooming. |
| **Unclustered pubs** | Keep drink silhouettes as the primary marker language; ensure icon scale stays readable without oversized pads. |
| **Discover ranks** | Shrink rank circles (~18–20px), soften fill; number secondary to pub/city name. |

Touch points: `components/PubMapCanvas.tsx` (cluster paint + source options), `lib/mapBasemapTaste.ts` (`clusterCircleColorExpr` if needed), `app/discover/discover.css`.

---

## 3. Flow fixes

1. **City rivalry → preferred city + fit bounds**  
   Rivalry row links (`CityRivalryTable` → `cityMapShareUrl`) should also persist preferred city (`lib/cityPreference`) and land the map with bounds fit for that city — not a London-centric default when the user picked Glasgow/Manchester/etc.

2. **Drink chips → matching shapes**  
   Discover category cards deep-link via `exploreHref` (`?drink=`). Brand chips under “Jump by brand” add `brand`. Verify decode → map filter shows only matching drink-pin kinds (champagne → wine silhouette). Chip landing must leave the drink lens active so filtered shapes dominate, not a sea of mixed clusters.

---

## 4. London / TfL note

**No London MCP** in the cloud agent catalog — do not invent or wait on one.

Reuse existing integration only:

- `/api/last-train` for last-train guidance  
- `tfl_lines.json` + TfL icons already registered in `lib/mapIcons.ts` (`ns: "tfl"`) and drawn in `PubMapCanvas`

Transport layers stay wayfinding chrome; they must not outshine drink pins.

**Pint-drops / Supabase:** `/api/pint-drops` returning 503 in local or prod when Supabase is required is separate infra — do not fake drops or invent a London MCP substitute for community prices.

---

## 5. QA flows (browser)

1. Open `/map` at London default zoom — clusters are compact; zoom in until drink silhouettes dominate.  
2. Apply beer / wine / cocktail / spirits filter — pins match silhouettes; champagne venues show wine.  
3. Discover → city rivalry row (non-London) → map opens that city, preferred city set, camera fits bounds.  
4. Discover → drink chip → map with drink filter on and matching shapes visible.  
5. Discover rankings — rank numerals small, names primary.  
6. Spot-check TfL / last-train still works; no London MCP dependency.

---

## 6. Success criteria

- At city overview zoom, user is not confronted by oversized green/red/orange cluster discs.  
- Drink silhouettes are the memorable map language once zoomed or filtered.  
- Discover ranks are quiet ordinals, not big red badges.  
- Rivalry and drink chips land on the right city + filter with shapes that match intent.  
- London transit continues via existing TfL paths only.
