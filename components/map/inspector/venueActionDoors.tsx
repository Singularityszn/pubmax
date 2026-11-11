import type { ReactNode } from "react";

import type { CommunityPrice } from "@/lib/communityPrice";
import type { PintTrustState } from "@/lib/pintTrust";
import { hasFreshDrinkerPrice, venueSheetDoors } from "@/lib/venuePlanDoor";
import type { CrawlMode } from "@/lib/venues";

import VenueLogDoor from "./VenueLogDoor";
import VenuePeekPlanDoor from "./VenuePeekPlanDoor";

/**
 * The action card's doors, as lib/venuePlanDoor.ts decides them: the coral for
 * the first row, and the plan door as a ghost for the action row when the
 * coral is "Log what you paid". `logFirst` tells the price cell that the coral
 * already asks for a price, so the cell does not ask again.
 */
export function venueActionDoors(input: {
  venueId: string;
  venueName: string;
  isPub: boolean;
  mode: CrawlMode;
  builtIds: readonly string[];
  pintTrust: PintTrustState | null | undefined;
  communityPint: Pick<CommunityPrice, "submittedAt"> | null | undefined;
  onLog: () => void;
  onAcceptStop1: () => void;
  onToggleStop: (id: string) => void;
}): { coral: ReactNode; ghost: ReactNode; logFirst: boolean } {
  const { logFirst, planDoor } = venueSheetDoors({
    isPub: input.isPub,
    mode: input.mode,
    builtIds: input.builtIds,
    venueId: input.venueId,
    canAcceptStop1: input.isPub,
    freshDrinkerPrice: hasFreshDrinkerPrice(input),
  });
  const door = (tone: "coral" | "ghost") => (
    <VenuePeekPlanDoor
      door={planDoor}
      venueId={input.venueId}
      venueName={input.venueName}
      onAcceptStop1={input.onAcceptStop1}
      onToggleStop={input.onToggleStop}
      tone={tone}
    />
  );
  if (!logFirst) return { coral: door("coral"), ghost: null, logFirst };
  return {
    coral: <VenueLogDoor venueName={input.venueName} onLog={input.onLog} />,
    ghost: door("ghost"),
    logFirst,
  };
}
