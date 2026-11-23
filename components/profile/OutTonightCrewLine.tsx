"use client";

// The quiet "out tonight" line on a crew mate's profile. Renders NOTHING
// unless lib/socialFeed.ts admits an active check-in for the profile owner.
// No toggle here - a viewer can only ever see someone else's
// check-in, never switch it.

import { useEffect, useRef, useState } from "react";

import OutTonightPlanCta from "@/components/profile/OutTonightPlanCta";
import { discardBody } from "@/lib/responseBody";
import { authedFetch } from "@/lib/authedFetch";
import { tryGetNightArea, type NightAreaSlug } from "@/lib/nightAreas";
import { normalizeHandle } from "@/lib/profiles";
import { useSocialFriendsLaunch } from "@/lib/useSocialFriendsLaunch";
import { useAuth } from "@/components/auth/AuthProvider";

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
  const { accountRevision } = useAuth();
  const [state, setState] = useState<State>({ kind: "hidden" });
  const [stateScope, setStateScope] = useState("");
  const scope = `${accountRevision}:${normalizeHandle(ownerHandle)}:${normalizeHandle(viewerHandle)}`;
  const scopeRef = useRef(scope);

  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  useEffect(() => {
    const requestScope = scope;
    let active = true;
    if (!socialFriendsLaunchEnabled || !ownerHandle || !viewerHandle) {
      void Promise.resolve().then(() => {
        if (!active) return;
        setState({ kind: "hidden" });
        setStateScope(requestScope);
      });
      return () => {
        active = false;
      };
    }
    const controller = new AbortController();
    (async () => {
      try {
        const url = `/api/check-ins?viewer=${encodeURIComponent(viewerHandle)}`;
        const res = await authedFetch(url, { signal: controller.signal }, { requiresIdentity: true });
        if (!res.ok) {
          discardBody(res);
          throw new Error(`check-ins ${res.status}`);
        }
        const body = (await res.json()) as { checkIns?: CheckInDto[] };
        const owner = normalizeHandle(ownerHandle);
        const mine = (body.checkIns ?? []).find((c) => normalizeHandle(c.handle ?? "") === owner);
        if (!active || scopeRef.current !== requestScope) return;
        setStateScope(requestScope);
        if (mine) {
          setState({ kind: "visible", areaSlug: (mine.areaSlug as NightAreaSlug) ?? null });
        } else {
          setState({ kind: "hidden" });
        }
      } catch {
        // Fail quiet: a check-in that can't be confirmed simply doesn't show.
        if (active && scopeRef.current === requestScope) setState({ kind: "hidden" });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountRevision, ownerHandle, scope, socialFriendsLaunchEnabled, viewerHandle]);

  if (!socialFriendsLaunchEnabled || stateScope !== scope || state.kind === "hidden") return null;

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
