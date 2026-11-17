"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/AuthProvider";
import {
  readDeviceAccountSessionRevision,
  subscribeDeviceAccountSession,
} from "@/lib/deviceAccountIdentity";
import { trackEvent } from "@/lib/analytics";
import type { MissionSurface } from "@/lib/analyticsEvents";
import { authedActionFetch } from "@/lib/authedFetch";
import {
  completePriceEvidenceMission,
  dismissPriceEvidenceMission,
  readDismissedMissions,
} from "@/lib/priceEvidenceMissionDismiss";
import {
  buildPriceEvidenceMissionUrl,
  dismissedVenueIds,
  readPriceEvidenceMissionWithDeadline,
  startPriceEvidenceMissionRequest,
  type PriceEvidenceMissionRead,
} from "@/lib/priceEvidenceMissionClient";
import {
  missionAnalyticsProps,
  type PriceEvidenceMission,
} from "@/lib/priceEvidenceMissions";
import { safeSessionStorage } from "@/lib/safeStorage";

type PriceEvidenceMissionView =
  | { status: "idle" }
  | { status: "loading" }
  | PriceEvidenceMissionRead;

export function usePriceEvidenceMission(input: {
  venueIds: readonly string[];
  enabled: boolean;
  surface: MissionSurface;
}): {
  mission: PriceEvidenceMission | null;
  status: PriceEvidenceMissionView["status"];
  dismiss: (mission: PriceEvidenceMission) => void;
  /** The ask was answered: take the card away without calling it a skip. */
  complete: (mission: PriceEvidenceMission) => void;
} {
  const { user, identityResolved } = useAuth();
  const signedIn = Boolean(identityResolved && user);
  const revision = useSyncExternalStore(
    subscribeDeviceAccountSession,
    readDeviceAccountSessionRevision,
    () => 0,
  );
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [dismissedRevision, setDismissedRevision] = useState(revision);
  if (dismissedRevision !== revision) {
    setDismissedRevision(revision);
    setDismissed(readDismissedMissions(safeSessionStorage()));
  }
  useEffect(() => {
    // Session storage is the only owner of skip state across this tab.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(readDismissedMissions(safeSessionStorage()));
  }, []);
  const requestIds = useMemo(() => {
    const skipped = dismissedVenueIds(dismissed);
    return input.venueIds.filter((venueId) => venueId && !skipped.has(venueId));
  }, [dismissed, input.venueIds]);
  const requestUrl = useMemo(
    () => buildPriceEvidenceMissionUrl(requestIds),
    [requestIds],
  );
  const enabled = input.enabled && signedIn && Boolean(requestUrl);
  const [resolved, setResolved] = useState<{
    requestUrl: string;
    revision: number;
    view: PriceEvidenceMissionView;
  }>({ requestUrl: "", revision: -1, view: { status: "idle" } });
  const generationRef = useRef(0);
  const viewedKey = useRef<string | null>(null);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!enabled || !requestUrl) {
      return;
    }
    // External read owns this paint. The last answer stays until this one lands.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolved({ requestUrl, revision, view: { status: "loading" } });
    const accountBoundFetch = (input: RequestInfo | URL, init?: RequestInit) =>
      authedActionFetch(input, init ?? {}, { requiresIdentity: true });
    const request = startPriceEvidenceMissionRequest(
      requestUrl,
      accountBoundFetch,
    );
    // The deadline may only degrade a read that is still in flight, so the
    // race settles exactly once and a mission that landed stays put.
    const read = readPriceEvidenceMissionWithDeadline(request);
    void read.settled.then((outcome) => {
      if (outcome.outcome === "abandoned") return;
      if (generation !== generationRef.current || revision !== readDeviceAccountSessionRevision()) return;
      setResolved({
        requestUrl,
        revision,
        view:
          outcome.outcome === "read"
            ? outcome.read
            : { status: "degraded", mission: null },
      });
    });
    return () => {
      read.cancel();
    };
  }, [enabled, requestUrl, revision]);

  const view: PriceEvidenceMissionView = !enabled
    ? { status: "idle" }
    : resolved.revision === revision && resolved.requestUrl === requestUrl
      ? resolved.view
      : { status: "loading" };
  const mission = view.status === "ready" || view.status === "degraded"
    ? view.mission
    : null;

  useEffect(() => {
    if (!mission) return;
    const key = `${revision}:${input.surface}:${mission.venueId}:${mission.reason}:${mission.drinkCategory ?? ""}`;
    if (viewedKey.current === key) return;
    viewedKey.current = key;
    trackEvent("mission_viewed", missionAnalyticsProps(input.surface, mission));
  }, [input.surface, mission, revision]);

  const dismiss = useCallback(
    (current: PriceEvidenceMission) => {
      if (revision !== readDeviceAccountSessionRevision()) return;
      const next = dismissPriceEvidenceMission(
        current,
        safeSessionStorage(),
      );
      setDismissed(next);
      trackEvent(
        "mission_dismissed",
        missionAnalyticsProps(input.surface, current),
      );
    },
    [input.surface, revision],
  );

  // A logged price ANSWERS the mission, so the card leaves the way a dismissal
  // takes it away, and for the same session reason: the next read must not
  // offer this pub back in the tab that has just reported it. It emits no
  // `mission_dismissed`, because nothing was skipped; the composer's own
  // `mission_submitted` is the event for this moment.
  const complete = useCallback((current: PriceEvidenceMission) => {
    if (revision !== readDeviceAccountSessionRevision()) return;
    setDismissed(
      completePriceEvidenceMission(
        current,
        safeSessionStorage(),
      ),
    );
  }, [revision]);

  return { mission, status: view.status, dismiss, complete };
}
