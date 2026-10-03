export const APPLIED_LIST_SQL: string;

export function databaseUrlFrom(env: Record<string, string | undefined>): string | null;

export function compareSchemaLevel(
  migrations: readonly string[],
  appliedText: string,
): { missing: string[]; outOfOrder: string[] };

export function formatSchemaLevelReport(report: {
  missing: readonly string[];
  outOfOrder: readonly string[];
}): string;

export function fetchAppliedList(
  env: Record<string, string | undefined>,
  execFile?: (
    file: string,
    args: readonly string[],
    options: { encoding: "utf8"; env: NodeJS.ProcessEnv },
  ) => string,
): string;
