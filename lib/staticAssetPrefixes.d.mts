export declare const STATIC_ASSET_PREFIXES: readonly string[];
export declare const BUILD_WRITTEN_STATIC_ASSET_PREFIXES: Readonly<
  Record<string, Readonly<{ npmScript: string; script: string; reason: string }>>
>;
export declare function isBuildWrittenStaticAssetPrefix(
  prefix: string,
): boolean;
export declare const STATIC_ASSET_EXTENSIONS: readonly string[];
export declare const STATIC_ASSET_FILE_DIRECTORIES: readonly string[];
export declare function staticAssetMatcherAlternatives(): string;
export declare function staticAssetExtensionMatcherAlternative(): string;
export declare function isStaticAssetFile(pathname: string): boolean;
export declare function staticAssetHeaderSources(): string[];
export declare function isStaticAssetPath(pathname: string): boolean;
