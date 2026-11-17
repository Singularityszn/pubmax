"use client";

import { useEffect } from "react";
import { nextCameraRequestToken } from "@/lib/cameraIntent";

export function useCuratedWalkFraming(open: boolean, ready: boolean, frame: (owner: "user", requestToken: number, waitForPanel: boolean) => void | (() => void)) {
  useEffect(() => {
    if (!open || !ready) return;
    const requestToken = nextCameraRequestToken();
    return frame("user", requestToken, true);
  }, [open, ready, frame]);
}
