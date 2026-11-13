# Components, map canvas and the design system

Rendered surfaces: the MapLibre canvas, the sheets and chrome, and the launch primitives. Repo-wide rules are in the root [AGENTS.md](../AGENTS.md).

## Traps

- **Build a launch screen from the launch tokens and the four primitives.** `docs/DESIGN_SYSTEM.md` owns them, and tests fence template patterns. Pick a variant. Do not restyle a primitive in place.
- **Coral is spent twice.** A selection reads in ink. Monospace is for figures. A fill colour and a text colour are two tokens.
- **Do not grow the hotspot files.** `components/PubMap.tsx`, `components/PubMapCanvas.tsx` and `app/globals.css` are the most-fixed files in the repo. Extract from them. Map tests read some of their source, so move a fence with the code it guards.
- **A camera move has an owner.** There is one compass.
- **A pin's figure is the price.** Colour may only hint. An aging price looks aging, never fresh. A cluster reads "from" its cheapest price.
- **The map's first paint is a contract.** Pins arrive during the arrival flight, never before the basemap. Nothing on `/map` waits for ever for a map that never mounts.
- **No surface is a dead end.** A way in needs a way out, and the way out is one pattern.
- **Phone chrome is measured, not eyeballed.** The resting phone map is three layers. The primary row is five doors. A trust caption never ellipses. The count of controls only comes down.
- **A venue sheet says a fact once.** It has one action card, and that card spends the sheet's one coral.
- **next/image drops a `srcSet` prop.** Resize a proxied photo through its loader.
- **A wait is drawn from the real card.** Nothing moves when the answer lands.
- **The product answers first.** The consent card arrives after the answer. The install ask waits for a price answer.

## Detail

Read a detail file only for the rule you change. Each holds the full rules, pins and history:

- Map canvas and pins: [`docs/rules/components-map-canvas-and-pins.md`](../docs/rules/components-map-canvas-and-pins.md)
- Sheets, chrome and navigation: [`docs/rules/components-sheets-chrome-and-navigation.md`](../docs/rules/components-sheets-chrome-and-navigation.md)
- Venue, plan and message surfaces: [`docs/rules/components-venue-plan-and-message-surfaces.md`](../docs/rules/components-venue-plan-and-message-surfaces.md)
- Design system and launch primitives: [`docs/rules/components-design-system-and-launch-primitives.md`](../docs/rules/components-design-system-and-launch-primitives.md)
