import type { TrialAdapter, TrialEvent } from "./harness.mjs";

export interface FixtureVenue {
  readonly fixtureId: string;
  readonly label: string;
  readonly synthetic: true;
}

export interface FixtureStep {
  after: number;
  event: TrialEvent | Record<string, unknown>;
}

export const FIXTURE_VENUES: readonly FixtureVenue[];
export const FIXTURE_IDS: readonly string[];
export const FIXTURE_SCRIPTS: Readonly<Record<string, readonly FixtureStep[]>>;

export function createScriptedAdapter(options: {
  scripts?: Readonly<Record<string, readonly FixtureStep[]>>;
  schedule: (run: () => void, after: number) => void;
  honourAbort?: boolean;
}): TrialAdapter;
