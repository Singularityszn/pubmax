import { MAP_CANVAS_READINESS_CEILING_MS } from "@/lib/mapCanvasAvailability";

/**
 * UNTIL THE PINS HAVE PAINTED, THE WIRE BELONGS TO THE PINS.
 *
 * The captain's law already says the map a reader is looking at loads first and
 * the sides fill in. That law governed WHICH shards a lane asks for; it did not
 * govern WHEN a lane may ask at all, and a cold `/map` measured on the audit's
 * own rig (390x844, 4x CPU, Slow 4G) showed the difference costing seconds:
 *
 *   the venue rows merged at 5,743 ms, the scene was built at 7,722 ms, and
 *   between 7,031 ms and 7,830 ms the map opened 57 `venues_slim.cell.*`
 *   requests plus a 190 KB ambient POI read. MapLibre's own worker module was
 *   asked for at 7,173 ms and did not land until 10,948 ms - 3,775 ms for
 *   133 KB on a wire that carries it in about 720 ms - because it queued
 *   behind them. Only then could the worker parse the pubs source, ask for the
 *   glyph range and place a symbol. The first tappable pin arrived at
 *   13,512 ms.
 *
 * So the secondary streams are HELD until the pins have painted. Nothing is
 * dropped and nothing is fetched that was not fetched before: the sides fill in
 * the moment the map has something a thumb can hit, and no earlier.
 *
 * A HOLD IS NEVER A CAGE. Three separate answers end it, and every one of them
 * is an answer this shell already has:
 *  - the pins painted (`pubmax:pin-reveal`, which the reveal coordinator also
 *    fires on its own honest ceiling, so a map whose pins never paint still
 *    releases);
 *  - the shell decided there is no canvas at all, the F08 lane, which is the
 *    one case where nothing will ever announce a painted pin;
 *  - the hold's own ceiling lapsed.
 */

/**
 * The hold's own upper bound, derived from the shell's maximum construction wait.
 * Construction stops the shell's clock but does not release this hold. The hold
 * keeps its own deadline while the canvas prepares its pins.
 */
export const MAP_SECONDARY_STREAM_HOLD_CEILING_MS = MAP_CANVAS_READINESS_CEILING_MS;

/**
 * The closed set of lanes this rule holds, named so a reader of one call site
 * can see the whole of it. Everything absent from this list is on the first
 * pin's own path and is never held: the opening shard read, the map chunk, the
 * style, the sprite, the worker module and the glyph range.
 */
export const HELD_MAP_SECONDARY_STREAMS = [
  "slim-shard-rings",
  "uk-base-layer",
  "ambient-poi-overlay",
  "london-restaurant-pack",
] as const;

export type MapSecondaryStreamSignals = {
  /** The canvas has announced a painted, tappable pin. */
  pinsRevealed: boolean;
  /** The shell has decided there is no canvas (module failure or its ceiling). */
  canvasUnavailable: boolean;
  /** {@link MAP_SECONDARY_STREAM_HOLD_CEILING_MS} has passed. */
  holdCeilingLapsed: boolean;
};

/** Whether the secondary lanes must still wait. */
export function mapSecondaryStreamsHeld(
  signals: MapSecondaryStreamSignals,
): boolean {
  if (signals.pinsRevealed) return false;
  if (signals.canvasUnavailable) return false;
  return !signals.holdCeilingLapsed;
}
