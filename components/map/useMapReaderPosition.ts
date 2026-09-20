"use client";

import { useEffect, useState } from "react";

import { attachMapReaderPositionWatch } from "@/lib/mapReaderPositionWatch";
import type { MapReaderPosition } from "@/lib/mapReaderPosition";

/**
 * Paints the reader's own position on the map (option A). Starts
 * `watchPosition` only when permission is already granted or after an existing
 * map location ask succeeds via {@link latchMapReaderLocationWatch}. Never
 * prompts on its own.
 */
export function useMapReaderPosition(): MapReaderPosition | null {
  const [position, setPosition] = useState<MapReaderPosition | null>(null);

  useEffect(() => attachMapReaderPositionWatch(setPosition), []);

  return position;
}
