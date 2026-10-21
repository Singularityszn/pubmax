"use client";

import { useState } from "react";

import { mapArrivalFrame } from "@/lib/pubMap";
import { parseMapAreaArrival } from "@/lib/mapAreaArrival";

export function useMapOpeningArrival(input: Omit<Parameters<typeof mapArrivalFrame>[0], "search">) {
  const [arrival] = useState(() => {
    const search = typeof window === "undefined" ? "" : window.location.search;
    return {
      search,
      frame: mapArrivalFrame({ ...input, search }),
      area: parseMapAreaArrival(search, input.cityId),
    };
  });
  return arrival;
}
