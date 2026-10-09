// The map's ODbL credit: one licence line, painted on the map as MapLibre's
// compact (i) and repeated as copy under the Key in More map controls.
//
// History. UI audit, 2026-09-01, production, 390x844: four info glyphs rendered
// stacked on a white rounded blob, because raising MapLibre's 24px button to the
// 44px tap floor tiled its 24px background glyph 2 x 2. That was fixed by
// shaping the control, and the rendered circle, its berth above the bottom card
// and the credit's place under the Key are proven in a browser
// (e2e/drink-chip-controls.spec.ts, e2e/mobile-map-chrome-fit.spec.ts).
//
// What may NOT change is the credit itself: OSM_ATTRIBUTION is the map's
// customAttribution, and the phone's copy reads the same constant.

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { OSM_ATTRIBUTION } from "@/components/map/canvas/tokens";
import MapCredits from "@/components/map/MapCredits";
