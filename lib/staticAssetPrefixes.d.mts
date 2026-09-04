export declare const STATIC_ASSET_PREFIXES: readonly string[];
export declare const BUILD_WRITTEN_STATIC_ASSET_PREFIXES: Readonly<
  Record<string, Readonly<{ npmScript: string; script: string; reason: string }>>
>;
export declare function isBuildWrittenStaticAssetPrefix(
  prefix: string,
): boolean;
export declare function staticAssetMatcherAlternatives(): string;
export declare function staticAssetHeaderSources(): string[];
export declare function isStaticAssetPath(pathname: string): boolean;
