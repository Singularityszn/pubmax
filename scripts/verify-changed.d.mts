export type ChangedFile = { readonly path: string; readonly status: "A" | "M" | "D" };

export type CheckPlan = {
  readonly full: string | null;
  readonly lint: string[];
  readonly typecheck: string[];
  readonly tests: string[];
  readonly rls: boolean;
  readonly validateData: boolean;
  readonly dbTypes: boolean;
  readonly e2eSkips: boolean;
  readonly chatgptMap: boolean;
};

export type CheckStep = {
  readonly label: string;
  readonly command: string;
  readonly args: string[];
  readonly env?: Record<string, string>;
};

export declare function importGraph(
  files: readonly string[],
  readText: (path: string) => string,
  resolverCandidates?: readonly string[],
): Map<string, Set<string>>;

export declare function planChecks(input: {
  changed: readonly ChangedFile[];
  importers: ReadonlyMap<string, ReadonlySet<string>>;
  testFiles: readonly string[];
  readText: (path: string) => string;
  env?: Record<string, string | undefined>;
}): CheckPlan;

export declare function checkSteps(plan: CheckPlan): CheckStep[];
