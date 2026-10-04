export function disposablePlanMigrations(): string[];

export function startDisposablePlanDb(): Promise<{
  restBaseUrl: string;
  serviceRoleKey: string;
  sql(statement: string): { ok: boolean; out: string; err: string; raw?: string };
  stop(): Promise<void>;
  lastMigration: string;
  fixtures: Array<{ venueId: string; category: string; pence: number; reportedAt: string }>;
}>;
