export const PRODUCTION_PROJECT_REF: string;
export const LEDGER_QUERY: string;

export type LocalMigration = { file: string; version: string; name: string; bare: string };

export function localMigrations(directory: string): LocalMigration[];

export function compareLedger(
  local: ReadonlyArray<Pick<LocalMigration, "file" | "name" | "bare">>,
  remoteNames: Iterable<string>,
): { missing: string[]; remoteOnly: string[] };

export function fetchRemoteLedger(input: {
  projectRef: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]>;

export function resolveLedgerTarget(env?: Record<string, string | undefined>): {
  token: string;
  projectRef: string;
};

export function checkMigrationLedger(options?: {
  directory?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  say?: (line: string) => void;
}): Promise<{ missing: string[]; remoteOnly: string[] }>;
