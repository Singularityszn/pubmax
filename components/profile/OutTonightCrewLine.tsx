"use client";

// The quiet "out tonight" line on a crew mate's profile. Renders NOTHING
// unless the profile owner is a mutual follow of the viewer AND has an
// active check-in right now. Reads GET /api/check-ins?viewer=<viewerHandle>,
// which already runs through the single privacy choke (lib/socialFeed.ts) and
// only ever returns the viewer's own row plus their mutuals' rows - this
// component just looks for the owner's handle in that list, never a direct
// store read. No toggle here - a viewer can only ever see someone else's
// check-in, never switch it.

import { useEffect, useState } from "react";

import OutTonightPlanCta from "@/components/profile/OutTonightPlanCta";
import { discardBody } from "@/lib/responseBody";
import { tryGetNightArea, type NightAreaSlug } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";

type Props = {
  /** The profile being viewed (the potential check-in owner). */
  ownerHandle: string;
  /** The signed-in viewer, or "" when signed out. */
  viewerHandle: string;
};

type State =
  | { kind: "hidden" }
  | { kind: "visible"; areaSlug: NightAreaSlug | null };

type CheckInDto = { handle?: string; areaSlug?: string | null };

export default function OutTonightCrewLine({ ownerHandle, viewerHandle }: Props) {
  const socialFriendsLaunchEnabled = useSocialFriendsLaunch();
  const [state, setState] = useState<State>({ kind: "hidden" });

  useEffect(() => {
    // No owner or no viewer: nothing to check. The initial state is already
    // "hidden", so there is nothing to set here.
    if (!socialFriendsLaunchEnabled || !ownerHandle || !viewerHandle) return;
    const controller = new AbortController();
    (async () => {
      try {
        const url = `/api/check-ins?viewer=${encodeURIComponent(viewerHandle)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          discardBody(res);
          throw new Error(`check-ins ${res.status}`);
        }
        const body = (await res.json()) as { checkIns?: CheckInDto[] };
        const owner = normalizeHandle(ownerHandle);
        const mine = (body.checkIns ?? []).find((c) => normalizeHandle(c.handle ?? "") === owner);
        if (mine) {
          setState({ kind: "visible", areaSlug: (mine.areaSlug as NightAreaSlug) ?? null });
        } else {
          setState({ kind: "hidden" });
        }
      } catch {
        // Fail quiet: a check-in that can't be confirmed simply doesn't show.
        setState({ kind: "hidden" });
      }
    })();
    return () => controller.abort();
  }, [ownerHandle, socialFriendsLaunchEnabled, viewerHandle]);

  if (!socialFriendsLaunchEnabled || state.kind === "hidden") return null;

  const areaName = tryGetNightArea(state.areaSlug)?.name ?? null;
  return (
    <div className="beaconCrewBlock">
      <p className="beaconCrewLine">
        {areaName ? `Out tonight in ${areaName}.` : "Out tonight."}
      </p>
      <OutTonightPlanCta variant="crew" />
    </div>
  );
}
