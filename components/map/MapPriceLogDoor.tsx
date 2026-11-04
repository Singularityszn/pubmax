"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlusCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { preferredCityMapHref } from "@/lib/cityPreference";
import { priceContributionMapHref } from "@/lib/priceContributionIntent";

/** Where the door goes before a browser location exists. */
const SERVER_HREF = "/map?contribute=price" as Route;

/**
 * "Log a price" on the phone map, among the map's own destinations in More
 * map controls. It asks "which pub?" on the map the reader is on, with its city
 * and drink kept (lib/priceContributionIntent.ts). A pub's own price door on
 * the venue sheet is the other way in.
 *
 * The floating create button carried this row over every page until the
 * five-tab dock (captain, 1 Nov 2026). The map writes its own address with
 * history.pushState, so the destination is read off the live address bar at
 * the tap, as SiteNav's Moment door does.
 *
 * The door REPLACES the More map controls entry rather than adding one. The
 * map's surface trail (components/map/pubmap/useMapSurfaceNavigation.ts)
 * counts only the entries it writes, and an extra entry under the price
 * picker sent Home back to More map controls, where the open sheet held the
 * map's top bar, and Back from the picker to a bare map one step short.
 */
export default function MapPriceLogDoor() {
  const router = useRouter();
  const liveHref = (): Route =>
    priceContributionMapHref(
      `${window.location.pathname}${window.location.search}`,
      preferredCityMapHref(),
    ) as Route;
  return (
    <Button asChild variant="secondary" className="w-full uiButton--start">
      <Link
        prefetch={false}
        replace
        href={SERVER_HREF}
        onPointerDown={(event) => { event.currentTarget.href = liveHref(); }}
        onClick={(event) => { event.currentTarget.href = liveHref(); }}
        onContextMenu={(event) => { event.currentTarget.href = liveHref(); }}
        onNavigate={(event) => {
          event.preventDefault();
          router.replace(liveHref());
        }}
      >
        <PlusCircle size={16} aria-hidden="true" />
        Log a price
      </Link>
    </Button>
  );
}
