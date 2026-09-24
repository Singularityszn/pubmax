export declare const POSTGRES_BACKED_SUITES: readonly string[];
export type PostgresSuiteRun = {
  readonly suites: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};
export declare const SERIAL_SHM_RUN: PostgresSuiteRun;
export declare const POSTGRES_SUITE_RUNS: readonly PostgresSuiteRun[];
