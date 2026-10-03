/** Each directory holding a committed package.json and package-lock.json. */
export const PACKAGE_DIRS: string[];

/** Why each allowScripts row runs (`runs: …`) or is skipped (`skipped: …`). */
export const INSTALL_SCRIPT_REASONS: Record<string, string>;

/** The package names in a lockfile that declare an install script. */
export function packagesWithInstallScripts(lock: {
  packages?: Record<string, { name?: string; hasInstallScript?: boolean }>;
}): string[];

export function checkAllowlist(
  found: string[],
  allowScripts: Record<string, unknown>,
  reasons: Record<string, string>,
): {
  unlisted: string[];
  stale: string[];
  unexplained: string[];
  notBoolean: string[];
  toRun: string[];
};
