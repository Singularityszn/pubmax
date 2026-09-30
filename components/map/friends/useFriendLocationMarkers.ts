"use client";

import { useLayoutEffect } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { FRIEND_LOCATION_FRESH_MS, type SharedFriendLocation } from "@/lib/friendLocation";

export function useFriendLocationMarkers(map: MapLibreMap | null, friends: SharedFriendLocation[]) {
  useLayoutEffect(() => {
    if (!map || !friends.length) return;
    const stage = map.getContainer().closest(".mapStage");
    const alreadyBlocked = stage?.classList.contains("ph-no-capture");
    stage?.classList.add("ph-no-capture");
    let disposed = false;
    const cleanup: (() => void)[] = [];
    void import("maplibre-gl").then(({ Marker }) => {
      if (disposed) return;
      for (const friend of friends) {
        const remaining = Math.min(Date.parse(friend.expiresAt), Date.parse(friend.updatedAt) + FRIEND_LOCATION_FRESH_MS) - Date.now();
        if (remaining <= 0) continue;
        const element = document.createElement("div");
        element.className = "friendLocationMarker ph-no-capture";
        element.setAttribute("role", "img");
        element.setAttribute("aria-label", `${friend.handle}. Last seen ${new Date(friend.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Accuracy about ${Math.ceil(friend.accuracy)} metres.`);
        const badge = document.createElement("span");
        badge.className = "friendLocationMarkerAvatar";
        badge.textContent = friend.handle.slice(0, 1).toUpperCase();
        const label = document.createElement("span");
        label.textContent = friend.handle;
        element.append(badge, label);
        const marker = new Marker({ element, anchor: "bottom" }).setLngLat([friend.longitude, friend.latitude]).addTo(map);
        const timer = setTimeout(() => marker.remove(), remaining);
        cleanup.push(() => { clearTimeout(timer); marker.remove(); });
      }
    });
    return () => { disposed = true; cleanup.forEach((remove) => remove()); if (!alreadyBlocked) stage?.classList.remove("ph-no-capture"); };
  }, [map, friends]);
}
