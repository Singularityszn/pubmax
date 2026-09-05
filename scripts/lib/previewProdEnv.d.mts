// Hand-written types for the plain-JS preview environment policy (allowJs is
// off). Keep in lockstep with scripts/lib/previewProdEnv.mjs.

export declare const PLATFORM_OWNED_PREFIXES: readonly string[];
export declare const PLATFORM_OWNED_NAMES: readonly string[];
export declare const SENSITIVE_PLACEHOLDER: string;
export declare const REFUSED_DEPLOY_FLAGS: Readonly<Record<string, string>>;

export declare function isPlatformOwnedName(name: string): boolean;

export declare function parsePulledEnvFile(
  contents: string,
): Array<[string, string]>;

export declare function classifyPulledEnv(contents: string): {
  forwarded: Array<[string, string]>;
  sensitive: string[];
  platform: string[];
};

export declare function deployEnvFlags(
  forwarded: ReadonlyArray<readonly [string, string]>,
): string[];

export declare function refusedFlagReason(
  args: readonly string[],
): { flag: string; reason: string } | null;
