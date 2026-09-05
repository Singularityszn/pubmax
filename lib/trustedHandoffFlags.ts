export const TRUSTED_HANDOFF_FLAG_KEYS = [
  "mapRouteTransfer",
  "tonightGrouping",
  "palHandoff",
  "socialFriendsLaunch",
] as const;

export type TrustedHandoffFlagKey = (typeof TRUSTED_HANDOFF_FLAG_KEYS)[number];

export type TrustedHandoffFlagsDTO = Readonly<Record<TrustedHandoffFlagKey, boolean>>;

export const TRUSTED_HANDOFF_FLAGS_OFF: TrustedHandoffFlagsDTO = Object.freeze({
  mapRouteTransfer: false,
  tonightGrouping: false,
  palHandoff: false,
  socialFriendsLaunch: false,
});

export function createTrustedHandoffFlagsDTO(
  values: Record<TrustedHandoffFlagKey, boolean>,
): TrustedHandoffFlagsDTO {
  return Object.freeze({
    mapRouteTransfer: values.mapRouteTransfer,
    tonightGrouping: values.tonightGrouping,
    palHandoff: values.palHandoff,
    socialFriendsLaunch: values.socialFriendsLaunch,
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
