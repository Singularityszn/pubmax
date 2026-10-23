export declare const MAP_ICON_SPRITE_FORMAT: number;
export declare const MAP_ICON_SPRITE_SOURCES: ReadonlyArray<{
  file: string;
  declarations: readonly string[] | null;
}>;
export declare const MAP_ICON_TOKEN_CSS_FILES: readonly string[];
export declare const MAP_ICON_TOKEN_CSS_PROPERTIES: Readonly<Record<string, `--${string}`>>;
export declare function printedTypeScript(
  repoRoot: string,
  file: string,
  declarations: readonly string[] | null,
): string;
export declare function cssCustomProperties(
  css: string,
): Array<{ context: string; name: string; value: string }>;
export declare function iconTokenCssClosure(
  repoRoot: string,
): Array<{ file: string; context: string; name: string; value: string }>;
export declare function mapIconSpriteFingerprint(repoRoot: string): string;
