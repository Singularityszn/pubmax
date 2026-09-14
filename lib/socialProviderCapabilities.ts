import { SOCIAL_PROVIDERS, type SocialProvider } from "@/lib/socialConnections";

export const SOCIAL_PROVIDER_CAPABILITY_NAMES = [
  "manual_link",
  "oauth_identity",
  "read_selected_content",
  "publish",
] as const;

export type SocialProviderCapability =
  (typeof SOCIAL_PROVIDER_CAPABILITY_NAMES)[number];
export type SocialProviderCapabilities = Record<SocialProviderCapability, boolean>;

const MANUAL_ONLY: SocialProviderCapabilities = {
  manual_link: true,
  oauth_identity: false,
  read_selected_content: false,
  publish: false,
};

/** Configuration cannot grant an uncertified provider capability. */
export const SOCIAL_PROVIDER_CAPABILITIES = Object.fromEntries(
  SOCIAL_PROVIDERS.map((provider) => [provider, { ...MANUAL_ONLY }]),
) as Record<SocialProvider, SocialProviderCapabilities>;

export function providerCapability(
  provider: SocialProvider,
  capability: SocialProviderCapability,
): boolean {
  return SOCIAL_PROVIDER_CAPABILITIES[provider][capability];
}

/**
 * Read a wire availability map into the closed provider record. Every provider
 * the client knows gets a row, and only a literal `true` grants a capability,
 * so a partial, older or malformed answer closes the missing controls instead
 * of crashing the editor that indexes the record.
 */
export function readProviderCapabilities(
  value: unknown,
): Record<SocialProvider, SocialProviderCapabilities> {
  const wire = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    SOCIAL_PROVIDERS.map((provider) => {
      const row = wire[provider];
      const flags = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      return [
        provider,
        Object.fromEntries(
          SOCIAL_PROVIDER_CAPABILITY_NAMES.map((name) => [name, flags[name] === true]),
        ),
      ];
    }),
  ) as Record<SocialProvider, SocialProviderCapabilities>;
}

export function availableProviderCapabilities(
  capabilities: SocialProviderCapabilities,
  oauthRuntimeReady: boolean,
): SocialProviderCapabilities {
  return {
    ...capabilities,
    oauth_identity: capabilities.oauth_identity && oauthRuntimeReady,
  };
}
