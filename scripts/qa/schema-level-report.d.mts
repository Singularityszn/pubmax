export const APPLIED_LIST_SQL: string;

export function compareSchemaLevel(
  migrations: readonly string[],
  appliedText: string,
): { missing: string[]; outOfOrder: string[] };

export function formatSchemaLevelReport(report: {
  target?: string;
  missing: readonly string[];
  outOfOrder: readonly string[];
}): string;

export function fetchAppliedList(
  env: Record<string, string | undefined>,
  execFile?: (
    file: string,
    args: readonly string[],
    options: {
      encoding: "utf8";
      stdio: ["ignore", "pipe", "pipe"];
      env: NodeJS.ProcessEnv;
    },
  ) => string,
): { target: string; text: string };
