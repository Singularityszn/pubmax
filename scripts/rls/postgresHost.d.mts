export declare const REQUIRED_POSTGRES_MAJOR: number;
export declare const POSTGRES_SLOT_ROOT: string;

export type PostgresBinaryName = "initdb" | "pg_ctl" | "postgres" | "psql";

export declare function findPostgresBinary(name: PostgresBinaryName): string | null;
export declare function missingPostgresReason(): string | null;
export declare function postgresSkipReason(): string | null;
export declare function maxPostgresClusters(): number;
export declare function acquireClusterSlot(label?: string): Promise<() => void>;
