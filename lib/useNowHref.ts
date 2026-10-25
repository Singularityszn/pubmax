"use client";

import { useSyncExternalStore } from "react";
import { londonHour } from "@/lib/londonHour";

// All currently selectable cities use Europe/London. Keep the host device's
// timezone out of this choice, including when the reader travels abroad.
function readNowHref(): "/today" | "/tonight" {
  return londonHour(new Date()) < 16 ? "/today" : "/tonight";
}

function subscribeClock(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const refresh = () => {
    clearTimeout(timer);
    onChange();
    // Align with the next minute so the 16:00 cutoff and midnight reset do
    // not wait for a polling interval started at an arbitrary second.
    timer = setTimeout(refresh, 60_000 - (Date.now() % 60_000));
  };
  refresh();
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}

/** The main tab's default only. Explicit Day/Tonight links keep their URL. */
export function useNowHref(): "/today" | "/tonight" {
  return useSyncExternalStore(subscribeClock, readNowHref, () => "/tonight");
}
