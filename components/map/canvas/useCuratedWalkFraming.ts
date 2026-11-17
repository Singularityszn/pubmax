"use client";

import { useEffect } from "react";
import { nextCameraRequestToken } from "@/lib/cameraIntent";
import { whenWalkPanelSettles } from "./useMapCamera";

export function useCuratedWalkFraming(open: boolean, ready: boolean, frame: (owner: "user", requestToken: number) => void) {
  useEffect(() => {
    if (!open || !ready) return;
    const requestToken = nextCameraRequestToken();
    return whenWalkPanelSettles(() => frame("user", requestToken), true);
  }, [open, ready, frame]);
}
