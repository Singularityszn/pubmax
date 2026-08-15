import "server-only";

import {
  createTrustedHandoffFlagsDTO,
  isTrustedHandoffFlagKey,
  type TrustedHandoffFlagKey,
  type TrustedHandoffFlagsDTO,
} from "@/lib/trustedHandoffFlags";

export type TrustedHandoffFlagDefinition = Readonly<{
  env: string;
  ownerLane: string;
  removalCondition: string;
  offBehavior: string;
}>;

export const TRUSTED_HANDOFF_FLAG_DEFINITIONS = Object.freeze({
  intentWrite: {
    env: "PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE",
    ownerLane: "L03",
    removalCondition: "Remove after PlanningIntent V1 is the only supported acceptance producer and rollback window closes.",
    offBehavior: "No new PlanningIntent writes; existing Near and Map paths remain available.",
  },
  intentRead: {
    env: "PUBMAX_TRUSTED_HANDOFF_INTENT_READ",
    ownerLane: "L03",
    removalCondition: "Remove after V2 draft migration and intent arbitration are permanently active.",
    offBehavior: "Stored intent is ignored but preserved; generic Plan remains available.",
  },
  anchoredGeneration: {
    env: "PUBMAX_ANCHORED_GENERATION",
    ownerLane: "L08",
    removalCondition: "Remove after anchored generation and one-Stop lifecycle complete the rollback window.",
    offBehavior: "Accepted Venue remains provisional; no silent unanchored generation occurs.",
  },
  mapRouteTransfer: {
    env: "PUBMAX_MAP_ROUTE_TRANSFER",
    ownerLane: "L12",
    removalCondition: "Remove after Map-to-Plan transfer is the stable default and legacy regeneration fallback retires.",
    offBehavior: "Existing Map preview remains; Plan can use its existing generation path.",
  },
  tonightGrouping: {
    env: "PUBMAX_TONIGHT_GROUPING",
    ownerLane: "L14",
    removalCondition: "Remove after canonical server grouping, locality, and diversity complete the rollback window.",
    offBehavior: "Retain schedule-safe chain duplicate collapse; disable only V2 server locality, diversity, and grouped response behavior.",
  },
  palHandoff: {
    env: "PUBMAX_PAL_HANDOFF",
    ownerLane: "L16",
    removalCondition: "Remove after Pal acceptance handoff is stable and old result navigation is retired.",
    offBehavior: "Existing Pal results remain; Pal does not write PlanningIntent.",
  },
  friendMemberRehydrationV2: {
    env: "PUBMAX_FRIEND_MEMBER_REHYDRATION_V2",
    ownerLane: "L10",
    removalCondition: "Remove after capability-aware member rehydration is the only supported full-state path.",
    offBehavior: "Everyone receives the safe privacy preview; anonymous Route leakage remains impossible.",
  },
} satisfies Record<TrustedHandoffFlagKey, TrustedHandoffFlagDefinition>);

export function parseTrustedHandoffFlag(value: string | undefined): boolean {
  return value === "1";
}

export function readTrustedHandoffFlags(
  env: Record<string, string | undefined> = process.env,
): TrustedHandoffFlagsDTO {
  return createTrustedHandoffFlagsDTO({
    intentWrite: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.intentWrite.env]),
    intentRead: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.intentRead.env]),
    anchoredGeneration: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.anchoredGeneration.env]),
    mapRouteTransfer: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.mapRouteTransfer.env]),
    tonightGrouping: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.tonightGrouping.env]),
    palHandoff: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.palHandoff.env]),
    friendMemberRehydrationV2: parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.friendMemberRehydrationV2.env]),
  });
}

export function readTrustedHandoffFlag(
  key: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!isTrustedHandoffFlagKey(key)) return false;
  return parseTrustedHandoffFlag(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS[key].env]);
}
