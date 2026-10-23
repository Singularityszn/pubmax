export type CoverageRun = {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};
export declare const WITHOUT_POSTGRES: "--without-postgres";
export declare function coverageRuns(forwarded: readonly string[]): CoverageRun[];
