export const TRUSTED_HANDOFF_FLAG_KEYS = [
  "socialFriendsLaunch",
] as const;

export type TrustedHandoffFlagKey = (typeof TRUSTED_HANDOFF_FLAG_KEYS)[number];

export type TrustedHandoffFlagsDTO = Readonly<Record<TrustedHandoffFlagKey, boolean>>;

export function createTrustedHandoffFlagsDTO(
  values: Record<TrustedHandoffFlagKey, boolean>,
): TrustedHandoffFlagsDTO {
  return Object.freeze({
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
