type PlaywrightDistDirEnv = Readonly<
  Partial<
    Pick<NodeJS.ProcessEnv, "NEXT_DIST_DIR" | "PW_NEXT_DIST_DIR" | "PW_SCREENSHOTS">
  >
>;

export function resolvePlaywrightNextDistDir(
  env: PlaywrightDistDirEnv = process.env,
): string {
  if (env.PW_NEXT_DIST_DIR !== undefined) return env.PW_NEXT_DIST_DIR;
  if (env.PW_SCREENSHOTS) return env.NEXT_DIST_DIR ?? ".next";
  return ".next-e2e";
}
