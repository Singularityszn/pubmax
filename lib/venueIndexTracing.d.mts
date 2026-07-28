export type RuntimeDataPack = {
  readonly id: string;
  readonly module: string;
  readonly files: readonly string[];
};

export const RUNTIME_DATA_PACKS: readonly RuntimeDataPack[];

export function discoverRuntimeReaderRouteGlobs(
  projectRoot: string,
  moduleRelativePath: string,
): string[];

export function runtimeDataPackRouteIncludes(projectRoot: string): Record<string, string[]>;
