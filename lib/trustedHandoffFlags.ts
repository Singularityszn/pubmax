export const TRUSTED_HANDOFF_FLAG_KEYS = [
  "intentWrite",
  "intentRead",
  "anchoredGeneration",
  "mapRouteTransfer",
  "tonightGrouping",
  "palHandoff",
  "friendMemberRehydrationV2",
] as const;

export type TrustedHandoffFlagKey = (typeof TRUSTED_HANDOFF_FLAG_KEYS)[number];

export type TrustedHandoffFlagsDTO = Readonly<Record<TrustedHandoffFlagKey, boolean>>;

export const TRUSTED_HANDOFF_FLAGS_OFF: TrustedHandoffFlagsDTO = Object.freeze({
  intentWrite: false,
  intentRead: false,
  anchoredGeneration: false,
  mapRouteTransfer: false,
  tonightGrouping: false,
  palHandoff: false,
  friendMemberRehydrationV2: false,
});

export function createTrustedHandoffFlagsDTO(
  values: Record<TrustedHandoffFlagKey, boolean>,
): TrustedHandoffFlagsDTO {
  return Object.freeze({
    intentWrite: values.intentWrite,
    intentRead: values.intentRead,
    anchoredGeneration: values.anchoredGeneration,
    mapRouteTransfer: values.mapRouteTransfer,
    tonightGrouping: values.tonightGrouping,
    palHandoff: values.palHandoff,
    friendMemberRehydrationV2: values.friendMemberRehydrationV2,
  });
}

export function isTrustedHandoffFlagKey(value: string): value is TrustedHandoffFlagKey {
  return (TRUSTED_HANDOFF_FLAG_KEYS as readonly string[]).includes(value);
}

export function trustedHandoffFlagEnabled(
  flags: TrustedHandoffFlagsDTO,
  key: string,
): boolean {
  return isTrustedHandoffFlagKey(key) ? flags[key] : false;
}
