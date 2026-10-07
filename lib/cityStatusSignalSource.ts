// The source line under a CityMCP status signal, in ONE place so the desktop
// status sheet and the phone Transit tab print the same words.
//
// The upstream digest returns a `sourceUrl` for most signals. A signal with a
// link says who published it, as the host ("timeout.com"), and a signal
// without one says only that it came through CityMCP: it never borrows a
// source it was not given. Pure leaf, no store behind it.

import { firstHttp } from "@/lib/httpUrl";

export type CityStatusSignalSource = { href: string; label: string };

export function cityStatusSignalSource(
  sourceUrl: string | undefined,
): CityStatusSignalSource | null {
  const href = firstHttp(sourceUrl);
  if (!href) return null;
  const host = new URL(href).hostname.replace(/^www\./, "");
  return host ? { href, label: `Source: ${host} ↗` } : null;
}

/** What an unsourced signal says instead of a link. */
export const CITY_STATUS_UNSOURCED_LABEL = "CityMCP";
