"use client";

import Link from "next/link";
import { useState, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { transferMapRouteToDraft, type MapGeneratedRouteResponse, type DisplayedMapRoute } from "@/lib/mapRouteTransfer";

import { releaseAcceptedPlanContext } from "@/lib/planComposerHandoff";

export type { MapGeneratedRouteResponse as MapRouteResponse } from "@/lib/mapRouteTransfer";

const PLAN_HREF = "/plan?src=mobile-route-preview";
const PLAN_LABEL = "Open Plan to lock it in";

/**
 * Transfer the displayed route at the click. An unchanged generation keeps its
 * proof; edits become an explicit preview, never the captured original route.
 * With no generation to carry, retain the ordinary Plan navigation.
 */
export function MapRouteTransferButton({
  response,
  displayedRoute,
}: {
  response: MapGeneratedRouteResponse | null;
  displayedRoute?: DisplayedMapRoute;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!response) {
    return (
      <Button asChild size="large" variant="secondary" className="w-full">
        <Link href={PLAN_HREF}>{PLAN_LABEL}</Link>
      </Button>
    );
  }

  const movedAnchor = typeof response.anchorVenueId === "string" && displayedRoute
    && displayedRoute[0]?.id !== response.anchorVenueId;
  const handleTransfer = (event: MouseEvent<HTMLAnchorElement>, releaseAnchor = false) => {
    try {
      const storage = typeof window !== "undefined" ? window.localStorage : null;
      if (!transferMapRouteToDraft(response, storage, Date.now(), displayedRoute, releaseAnchor)) {
        event.preventDefault();
        setError(movedAnchor
          ? "This route moves your accepted Stop 1. Release it to review the current route in Plan."
          : "Could not carry this route to Plan. Your route is still here. Try again.");
        return;
      }
      if (movedAnchor && releaseAnchor && !releaseAcceptedPlanContext({
        planDraft: window.sessionStorage,
        routeDraft: window.localStorage,
      })) {
        event.preventDefault();
        setError("Could not release your accepted Stop 1. Your current route is still here. Try again.");
        return;
      }
      setError(null);
    } catch {
      event.preventDefault();
      setError("Could not carry this route to Plan. Your route is still here. Try again.");
    }
  };

  return (
    <>
      <Button asChild size="large" variant="secondary" className="w-full">
        <Link href={PLAN_HREF} onClick={(event) => handleTransfer(event)}>{PLAN_LABEL}</Link>
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {error && movedAnchor ? (
        <Button asChild size="large" variant="secondary" className="w-full">
          <Link href={PLAN_HREF} onClick={(event) => handleTransfer(event, true)}>
            Release Stop 1 and review current route
          </Link>
        </Button>
      ) : null}
    </>
  );
}
