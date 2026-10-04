export const COFFEE_PILOT_FILE: string;

export const COFFEE_PILOT_DRINKS: string[];

export const COFFEE_PILOT_BOX: {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
};

export function coffeePilotProblems(
  file: unknown,
  venueIds: ReadonlySet<string>,
  now?: number,
  venueNames?: ReadonlyMap<string, string>,
): string[];

export function shoreditchCafeNames(rootDir: string): Map<string, string>;

export function shoreditchCafeIds(rootDir: string): Set<string>;
