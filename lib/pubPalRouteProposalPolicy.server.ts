import "server-only";

import { routeAskDeterministically } from "@/lib/ask/router";
import type { AskResponseBody } from "@/lib/ask/types";
import { isPubPalGetHomeOrSobrietyIntent } from "@/lib/pubPalLlmFence";
import { getPubPalResult } from "@/lib/pubPalStore";

export const PUB_PAL_ROUTE_PROPOSALS_OFF =
  "Route proposals are off in your Pal settings. Turn them on in Pal to draft a route.";

export class PubPalRoutePreferencesUnavailableError extends Error {
  constructor() {
    super("I couldn't check your Pal route settings. Try again.");
    this.name = "PubPalRoutePreferencesUnavailableError";
  }
}

/** Only a verified caller or a captured tool-turn owner supplies this id. */
export async function pubPalRouteProposalsAllowed(ownerId: string | null): Promise<boolean> {
  if (!ownerId) return true;
  try {
    const saved = await getPubPalResult(ownerId);
    if (!saved.ok) throw new PubPalRoutePreferencesUnavailableError();
    return saved.value?.proposalPreferences.routes !== false;
  } catch {
    throw new PubPalRoutePreferencesUnavailableError();
  }
}

export function isPubPalRouteProposalAsk(query: string): boolean {
  return !isPubPalGetHomeOrSobrietyIntent(query) &&
    routeAskDeterministically(query).some((call) => call.name === "propose_plan");
}

export function pubPalRouteProposalsOffAnswer(): AskResponseBody {
  return {
    answer: PUB_PAL_ROUTE_PROPOSALS_OFF,
    cards: [],
    proposals: [],
    sources: [],
    status: "ready",
    toolsUsed: ["propose_plan"],
  };
}

/** Re-read at projection: a saved change made during an ask must still win. */
export async function projectPubPalRouteProposals<T extends AskResponseBody>(
  answer: T,
  ownerId: string | null,
): Promise<T | AskResponseBody> {
  const hasRoute = answer.toolsUsed.includes("propose_plan") ||
    answer.proposals.some((proposal) => proposal.kind === "draft_plan");
  if (hasRoute && !await pubPalRouteProposalsAllowed(ownerId)) {
    return {
      ...answer,
      ...pubPalRouteProposalsOffAnswer(),
      proposals: answer.proposals.filter((proposal) => proposal.kind !== "draft_plan"),
      toolsUsed: answer.toolsUsed,
    };
  }
  return answer;
}
