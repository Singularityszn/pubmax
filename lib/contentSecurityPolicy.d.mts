export type ClerkCspSources = {
  script: readonly string[];
  connect: readonly string[];
  img: readonly string[];
  frame: readonly string[];
};

export type SupabaseCspOrigins = Readonly<{
  https: string;
  wss: string;
}>;

export type ContentSecurityPolicyEnv = Readonly<Record<string, string | undefined>>;

export type ContentSecurityPolicySources = {
  isDev: boolean;
  clerk: ClerkCspSources;
  supabase: SupabaseCspOrigins | null;
  devSupabaseConnect: string | null;
};

export declare const CLERK_BOT_PROTECTION_ORIGIN: string;
export declare const CLERK_ABUSE_PROTECTION_ORIGIN: string;
export declare const CLERK_IMAGE_ORIGIN: string;
export declare const CDN_DOCUMENT_INLINE_SCRIPT_SOURCE: string;
export declare function clerkFrontendApiOriginFromKey(
  publishableKey: string | undefined,
): string | null;
export declare function clerkCspSourcesFromKey(
  publishableKey: string | undefined,
): ClerkCspSources;
export declare function supabaseCspOriginsFromEnv(
  env: ContentSecurityPolicyEnv,
): SupabaseCspOrigins | null;
export declare function devSupabaseConnectOrigin(
  env: ContentSecurityPolicyEnv,
  isDev: boolean,
): string | null;
export declare function buildContentSecurityPolicy(
  sources: ContentSecurityPolicySources & { inlineScriptSource: string },
): string;
export declare function contentSecurityPolicySources(
  env: ContentSecurityPolicyEnv,
): ContentSecurityPolicySources;
export declare function cdnDocumentContentSecurityPolicy(
  env: ContentSecurityPolicyEnv,
): string;
