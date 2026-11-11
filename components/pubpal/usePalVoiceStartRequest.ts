"use client";

import { useEffect, useRef } from "react";

import { readPalVoiceHost, subscribePalVoiceHost, takePalVoiceStartChime, type PalVoiceStartChime } from "@/lib/palVoiceHost";

/**
 * Start the call when the map chip asks (lib/palVoiceHost.ts), once per ask.
 * The host keeps this call mounted until it is engaged, so the ask cannot be
 * lost between the tap and the first "starting" render.
 */
export function usePalVoiceStartRequest(start: (chime: PalVoiceStartChime) => Promise<void>, ownerId: string | null): void {
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  useEffect(() => {
    let handled = 0;
    const take = () => {
      const { startPending, startRequest, startOwner } = readPalVoiceHost();
      if (!startPending || startRequest === handled || !ownerId || startOwner !== ownerId) return;
      // Never open the microphone for a page out of view.
      if (document.visibilityState === "hidden") return;
      handled = startRequest;
      void startRef.current(takePalVoiceStartChime());
    };
    take();
    return subscribePalVoiceHost(take);
  }, [ownerId]);
}
