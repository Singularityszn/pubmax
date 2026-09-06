import "server-only";

import {
  createTrustedHandoffFlagsDTO,
  isTrustedHandoffFlagKey,
  type TrustedHandoffFlagKey,
  type TrustedHandoffFlagsDTO,
} from "@/lib/trustedHandoffFlags";
import { isSocialFriendsLaunchEnabled } from "@/lib/socialLaunch";

export type TrustedHandoffFlagDefinition = Readonly<{
  env: string;
  ownerLane: string;
  removalCondition: string;
  offBehavior: string;
}>;

// Every key here is a rollout switch a deployment must be able to SET, so each
// one is documented in .env.example and __tests__/trustedHandoffFlags.test.ts
// fails the build when a key is registered without that line. A flag nobody
// sets in production is dark code: the three trusted-handoff rollout flags
// (Map-to-Plan transfer, Tonight grouping, the Pal handoff) were exactly that,
// on in CI and off in every deployment, so each is DELETED and its flag-on
// behaviour is now the only behaviour. That fence names them.
export const TRUSTED_HANDOFF_FLAG_DEFINITIONS = Object.freeze({
  socialFriendsLaunch: {
    env: "PUBMAX_SOCIAL_FRIENDS_LAUNCH",
    ownerLane: "L21",
    removalCondition: "Remove after Social has a stable default and the emergency rollback window closes.",
    offBehavior: "Explicit 0 keeps Social in preview while the launch is rolled back.",
  },
} satisfies Record<TrustedHandoffFlagKey, TrustedHandoffFlagDefinition>);

export function readTrustedHandoffFlags(
  env: Record<string, string | undefined> = process.env,
): TrustedHandoffFlagsDTO {
  return createTrustedHandoffFlagsDTO({
    socialFriendsLaunch: isSocialFriendsLaunchEnabled(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS.socialFriendsLaunch.env]),
  });
}

export function readTrustedHandoffFlag(
  key: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!isTrustedHandoffFlagKey(key)) return false;
  return isSocialFriendsLaunchEnabled(env[TRUSTED_HANDOFF_FLAG_DEFINITIONS[key].env]);
}
