// The crawl offline pack, browser half. When a crawl screen knows its stops,
// it asks the service worker to save each stop's public pub page, so the stop
// still reads with no signal (public/sw.js owns the saving and the bounds).
//
// It sends venue ids and nothing else: no plan id, no crew, no position. The
// worker fetches each page without cookies, so what lands in Cache Storage is
// the page any stranger gets.

export const CRAWL_OFFLINE_PACK_MESSAGE = "pubmax:crawl-offline-pack";
export const CRAWL_OFFLINE_PACK_MAX_STOPS = 12;

const VENUE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

export type CrawlOfflinePackMessage = {
  type: typeof CRAWL_OFFLINE_PACK_MESSAGE;
  venueIds: string[];
};

/** The message for these stops, or null when no stop has a usable id. */
export function crawlOfflinePackMessage(
  venueIds: readonly string[],
): CrawlOfflinePackMessage | null {
  const ids = [...new Set(venueIds.filter((id) => VENUE_ID.test(id)))].slice(
    0,
    CRAWL_OFFLINE_PACK_MAX_STOPS,
  );
  return ids.length > 0 ? { type: CRAWL_OFFLINE_PACK_MESSAGE, venueIds: ids } : null;
}

type PackNavigator = {
  serviceWorker?: { controller?: { postMessage: (message: unknown) => void } | null };
  connection?: { saveData?: boolean };
};

/**
 * Ask the worker to save the pack. False when nothing was sent: no worker
 * controls the page yet, the reader turned data saver on, or no stop has an id.
 */
export function requestCrawlOfflinePack(
  venueIds: readonly string[],
  nav: PackNavigator | undefined = typeof navigator === "undefined"
    ? undefined
    : (navigator as unknown as PackNavigator),
): boolean {
  const controller = nav?.serviceWorker?.controller;
  if (!controller || nav?.connection?.saveData === true) return false;
  const message = crawlOfflinePackMessage(venueIds);
  if (!message) return false;
  try {
    controller.postMessage(message);
    return true;
  } catch {
    return false;
  }
}
