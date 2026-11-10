"use client";

import { useState } from "react";
import { useConversationClientTool } from "@elevenlabs/react";

import { DEFAULT_CITY_ID } from "@/lib/cities";
import { createPalMapToolOrder, palMapToolAction } from "@/lib/palMapClientToolCall";
import { applyPalMapCommand, readPalMapState } from "@/lib/palMapCommands";
import { venueMapUrl } from "@/lib/venueMapUrl";

type MapDoor = {
  /** Open the map, or a pub's sheet on it, the way the person's own words do. */
  openMap: (href?: string, label?: string) => void;
  /** The map is on screen or already opening. */
  mapShown: () => boolean;
  /** Tell the agent what the map did, without interrupting it. */
  tell: (update: string) => void;
  /** The current call's liveness check, or null with no call. */
  callLive: () => (() => boolean) | null;
};

/**
 * The voice agent's map tools (lib/palMapClientTools.mjs). They only move the
 * view. The agent does not wait for them, so a refusal reaches it as a
 * contextual update. Must render inside the call's ConversationProvider.
 */
export function usePalMapClientTools({ openMap, mapShown, tell, callLive }: MapDoor): void {
  const [begin] = useState(createPalMapToolOrder);
  const run = async (tool: string, params: unknown): Promise<string> => {
    // A call that ended, or a newer map request, retires this one before it moves anything.
    const current = begin(callLive());
    if (!current()) return "The map request was dropped.";
    const areas = tool === "map_fly_to_area"
      ? (await import("@/lib/nightAreas")).getNightAreasForCity(DEFAULT_CITY_ID)
      : [];
    if (!current()) return "The map request was dropped.";
    const action = palMapToolAction(tool, params, { picks: readPalMapState().picks, areas });
    switch (action.kind) {
      case "refused":
        tell(action.update);
        return action.update;
      case "openMap":
        if (!mapShown()) openMap();
        return "The map is open.";
      case "clear":
        applyPalMapCommand({ kind: "clear" });
        return "The map is clear.";
      case "focusPick":
        applyPalMapCommand({ kind: "focusPick", number: action.pick.number, move: true });
        if (!mapShown()) openMap(undefined, `Showing ${action.pick.name}`);
        return `Showing pick ${action.pick.number}.`;
      case "openPickSheet":
        applyPalMapCommand({ kind: "focusPick", number: action.pick.number });
        openMap(venueMapUrl(action.pick.venueId), `Opening ${action.pick.name}`);
        return `Opening pick ${action.pick.number}.`;
      case "flyToArea":
        applyPalMapCommand({ kind: "flyToArea", centre: action.area.centre, radiusKm: action.area.radiusKm });
        if (!mapShown()) openMap(undefined, `Opening ${action.area.name}`);
        return `Showing ${action.area.name}.`;
    }
  };
  useConversationClientTool("map_open", (params: unknown) => run("map_open", params));
  useConversationClientTool("map_focus_pick", (params: unknown) => run("map_focus_pick", params));
  useConversationClientTool("map_open_pick_sheet", (params: unknown) => run("map_open_pick_sheet", params));
  useConversationClientTool("map_fly_to_area", (params: unknown) => run("map_fly_to_area", params));
  useConversationClientTool("map_clear", (params: unknown) => run("map_clear", params));
}
