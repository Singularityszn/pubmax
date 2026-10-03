export function listMigrations(migrationsDir?: string): string[];

export function versionOf(filename: string): string | null;

export function labelOf(filename: string): string | null;

export function descriptiveNameOf(filename: string): string;

export function parseAppliedVersions(text: string): Set<string>;

export function parseAppliedLabels(text: string): Set<string>;

export function parseAppliedNames(text: string): Set<string>;

export function isMigrationApplied(
  filename: string,
  appliedVersions: ReadonlySet<string>,
  appliedLabels?: ReadonlySet<string>,
  appliedNames?: ReadonlySet<string>,
): boolean;

export function unappliedMigrations(
  migrations: readonly string[],
  appliedVersions: ReadonlySet<string>,
  appliedLabels?: ReadonlySet<string>,
  appliedNames?: ReadonlySet<string>,
): string[];
