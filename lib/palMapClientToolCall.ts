import { PAL_MAP_MAX_PICKS, type PalMapPick } from "@/lib/palMapCommands";

// What one map client tool call from the voice agent may do
// (lib/palMapClientTools.mjs). The model names a pick number or an area, and
// both are checked here against closed lists: the picks on the map now and the
// city's night areas. A refusal is a short line for the agent, sent as a
// contextual update, so it can tell the person what the map has.

type Area = { name: string; slug: string; aliases: readonly string[]; centre: { lat: number; lng: number }; radiusKm: number };

export type PalMapToolAction =
  | { kind: "openMap" }
  | { kind: "focusPick"; pick: PalMapPick }
  | { kind: "openPickSheet"; pick: PalMapPick }
  | { kind: "flyToArea"; area: Area }
  | { kind: "clear" }
  | { kind: "refused"; update: string };

function normalize(text: string): string {
  return text.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ")
    .trim().replace(/^the /, "");
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= PAL_MAP_MAX_PICKS ? value : null;
}

function picksOnScreen(count: number): string {
  if (count === 0) return "No picks are on the map yet.";
  return count === 1 ? "1 pick is on the map." : `${count} picks are on the map.`;
}

function param(params: unknown, key: string): unknown {
  return params && typeof params === "object" ? (params as Record<string, unknown>)[key] : undefined;
}

/** The night area a spoken name points at: its slug, name or one of its aliases. */
export function palAreaNamed(name: string, areas: readonly Area[]): Area | null {
  const wanted = normalize(name);
  if (!wanted) return null;
  return areas.find((area) => [area.slug.replace(/-/g, " "), area.name, ...area.aliases]
    .some((label) => normalize(label) === wanted)) ?? null;
}

export function palMapToolAction(
  tool: string,
  params: unknown,
  { picks, areas = [] }: { picks: readonly PalMapPick[]; areas?: readonly Area[] },
): PalMapToolAction {
  if (tool === "map_open") return { kind: "openMap" };
  if (tool === "map_clear") return { kind: "clear" };
  if (tool === "map_focus_pick" || tool === "map_open_pick_sheet") {
    const number = pickNumber(param(params, "number"));
    const pick = picks.find((item) => item.number === number);
    if (!pick) {
      return { kind: "refused", update: `The map could not show ${number ? `pick ${number}` : "that pick"}. ${picksOnScreen(picks.length)}` };
    }
    return { kind: tool === "map_focus_pick" ? "focusPick" : "openPickSheet", pick };
  }
  if (tool === "map_fly_to_area") {
    const spoken = param(params, "area");
    const area = typeof spoken === "string" ? palAreaNamed(spoken, areas) : null;
    if (area) return { kind: "flyToArea", area };
    return { kind: "refused", update: "The map could not find that area. It knows London areas such as Soho, Camden and Peckham." };
  }
  return { kind: "refused", update: "The map has no such tool." };
}

/**
 * A tool call may act only while its voice call is live and no later map tool
 * call has started. `begin` takes the call's own liveness check and returns
 * the check this tool call must pass before each effect.
 */
export function createPalMapToolOrder(): (callLive: (() => boolean) | null) => () => boolean {
  let latest = 0;
  return (callLive) => {
    const ticket = ++latest;
    return () => ticket === latest && Boolean(callLive?.());
  };
}
