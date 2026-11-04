"use client";

import { useEffect } from "react";

import { requestCrawlOfflinePack } from "@/lib/crawlOfflinePack";

/**
 * The crawl offline pack, from the crawl screen: once the stops are known, ask
 * the worker to save each stop's pub page, so the crawl still reads in a
 * basement or on the Tube. Keyed on the ids alone, so a check-in or a cursor
 * move sends nothing.
 *
 * On a first visit no worker controls the page yet: registration runs after
 * load, so the first ask finds no controller. The screen therefore asks again
 * whenever control changes (that first claim, or a worker update), without
 * waiting for the stops to change. Data saver is checked on every ask.
 */
export function useCrawlOfflinePack(venueIds: readonly string[]): void {
  const stopIds = venueIds.join(",");
  useEffect(() => {
    if (!stopIds) return undefined;
    const ids = stopIds.split(",");
    requestCrawlOfflinePack(ids);
    const workers = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!workers) return undefined;
    const onControllerChange = () => {
      requestCrawlOfflinePack(ids);
    };
    workers.addEventListener("controllerchange", onControllerChange);
    return () => workers.removeEventListener("controllerchange", onControllerChange);
  }, [stopIds]);
}
