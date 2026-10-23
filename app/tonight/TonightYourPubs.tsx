"use client";

import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/authContext";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { fetchSavedForHandle, getSaved, SAVED_VENUE_FALLBACK_NAME } from "@/lib/savedPubs";
import {
  TONIGHT_YOUR_PUBS_DEVICE_NOTE,
  TONIGHT_YOUR_PUBS_LIMIT,
  TONIGHT_YOUR_PUBS_LOOKUP_LIMIT,
  TONIGHT_YOUR_PUBS_TITLE,
  tonightYourPubPicks,
  tonightYourPubsFoot,
} from "@/lib/tonightYourPubs";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { warmVenueDetail } from "@/lib/warmVenueDetail";

type ShelfRow = { venueId: string; name: string; listType: string; href: Route };

type Shelf = {
  rows: ShelfRow[];
  total: number;
  /** The handle the shelf was read for; it is drawn only while that is still the viewer's. */
  handle: string | null;
  /** True when the saves live in this browser only. */
  deviceOnly: boolean;
};

/**
 * The reader's own saved pubs, newest first (lib/tonightYourPubs.ts).
 *
 * It waits for the session to settle, because the device cache is where a
 * previous account's handle lives (components/auth/useViewerHandle.ts). A
 * handle reads the account's saves, which carry their names. Without one, or
 * when that read fails, the saves on this device are named from the map's own
 * venue detail, the same session cache the map's sheet opens from, so the tap
 * through lands warm. A reader with nothing saved costs no request at all, and
 * the shelf is not drawn.
 */
export default function TonightYourPubs() {
  const { identityResolved } = useAuth();
  const handle = useViewerHandle();
  const [shelf, setShelf] = useState<Shelf | null>(null);

  useEffect(() => {
    if (!identityResolved) return;
    const controller = new AbortController();
    async function load() {
      const durable = handle ? await fetchSavedForHandle(handle, controller.signal) : null;
      if (controller.signal.aborted) return;
      if (durable) {
        const names = new Map(durable.map((row) => [row.venueId, row]));
        const { picks, total } = tonightYourPubPicks(durable, TONIGHT_YOUR_PUBS_LOOKUP_LIMIT);
        setShelf({
          // The account store names a pub the index no longer holds with the
          // fallback label; that pub has no map link to open, so it is left off
          // like a closed one on this device, and the next save takes its row.
          rows: picks
            .map((pick) => ({
              venueId: pick.venueId,
              name: names.get(pick.venueId)?.venueName ?? "",
              listType: pick.listType,
              href: names.get(pick.venueId)?.venueMapUrl ?? venueMapUrl(pick.venueId),
            }))
            .filter((row) => row.name && row.name !== SAVED_VENUE_FALLBACK_NAME)
            .slice(0, TONIGHT_YOUR_PUBS_LIMIT),
          total,
          handle,
          deviceOnly: false,
        });
        return;
      }
      const { picks, total } = tonightYourPubPicks(getSaved(), TONIGHT_YOUR_PUBS_LOOKUP_LIMIT);
      if (picks.length === 0) {
        setShelf(null);
        return;
      }
      const looked = await Promise.all(picks.map((pick) => warmVenueDetail(pick.venueId)));
      if (controller.signal.aborted) return;
      const rows: ShelfRow[] = [];
      picks.forEach((pick, index) => {
        const result = looked[index];
        // A pub that has closed is not a plan for tonight, and an id is never a
        // name: either way the row is left off.
        if (result?.status !== "found" || result.venue.retired) return;
        rows.push({
          venueId: pick.venueId,
          name: result.venue.name,
          listType: pick.listType,
          href: venueMapUrl(result.venue.id),
        });
      });
      setShelf({ rows: rows.slice(0, TONIGHT_YOUR_PUBS_LIMIT), total, handle, deviceOnly: true });
    }
    void load();
    return () => controller.abort();
  }, [handle, identityResolved]);

  // A shelf read for another account, or before the session settled again, is
  // never drawn: after an account switch the old rows would otherwise stay up
  // while the new read runs, one account's saves under another's name.
  if (!identityResolved || !shelf || shelf.handle !== handle || shelf.rows.length === 0) return null;
  const foot = tonightYourPubsFoot(shelf.handle, shelf.total, shelf.rows.length);
  return (
    <section className="tonightYourPubs" aria-labelledby="tonight-your-pubs-title">
      <h2 className="tonightYourPubsTitle" id="tonight-your-pubs-title">
        {TONIGHT_YOUR_PUBS_TITLE}
      </h2>
      <ul className="tonightYourPubsList" data-testid="tonight-your-pubs">
        {shelf.rows.map((row) => (
          <li key={row.venueId} className="tonightYourPubsRow">
            <Link prefetch={false} className="tonightYourPubsLink pressable" href={row.href}>
              <span className="tonightYourPubsBody">
                <span className="tonightYourPubsName">{row.name}</span>
                <span className="tonightYourPubsMeta">{row.listType}</span>
              </span>
              <ArrowRight size={16} aria-hidden="true" className="tonightYourPubsArrow" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="tonightYourPubsFoot">
        {shelf.deviceOnly ? <span>{TONIGHT_YOUR_PUBS_DEVICE_NOTE} </span> : null}
        <Link prefetch={false} className="tonightYourPubsMore" href={foot.href}>
          {foot.label}
        </Link>
      </p>
    </section>
  );
}
