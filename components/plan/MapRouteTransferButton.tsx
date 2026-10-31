"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { transferMapRouteToDraft, type MapGeneratedRouteResponse } from "@/lib/mapRouteTransfer";

/** Where a map route preview locks in: Plan, which hydrates the carried draft. */
export const MAP_ROUTE_PLAN_HREF = "/plan?src=mobile-route-preview";
const PLAN_HREF = MAP_ROUTE_PLAN_HREF;
const PLAN_LABEL = "Open Plan to lock it in";

/**
 * Write a captured Map Route into the Plan draft as a link to Plan is followed,
 * so Plan hydrates the same Stops without a second generation. Every link that
 * says "lock it in on Plan" spends this, the sentence and the button alike.
 */
export function carryRouteToPlan(response: MapGeneratedRouteResponse | null): void {
  if (!response) return;
  try {
    const storage = typeof window !== "undefined" ? window.localStorage : null;
    transferMapRouteToDraft(response, storage);
  } catch {
    // Fail-soft: a blocked or full store never blocks the journey. The link
    // still navigates and Plan falls back to its existing generation path.
  }
}

/**
 * L12 transfer CTA. With a captured Map Route it writes the identical Route into
 * the Plan draft the instant the link is followed, so Plan hydrates the same
 * Stops/order/anchor/proof without a second generation request. With no Route to
 * carry it is the plain navigate-and-regenerate link.
 */
export function MapRouteTransferButton({
  response,
}: {
  response: MapGeneratedRouteResponse | null;
}) {
  if (!response) {
    return (
      <Button asChild size="large" variant="secondary" className="w-full">
        <Link href={PLAN_HREF}>{PLAN_LABEL}</Link>
      </Button>
    );
  }

  return (
    <Button asChild size="large" variant="secondary" className="w-full">
      <Link href={PLAN_HREF} onClick={() => carryRouteToPlan(response)}>{PLAN_LABEL}</Link>
    </Button>
  );
}
