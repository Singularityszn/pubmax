export { COFFEE_PILOT_BOX, COFFEE_PILOT_DRINKS, COFFEE_PILOT_FILE } from "./coffeePilotArea.mjs";

export function coffeePilotProblems(
  file: unknown,
  venueIds: ReadonlySet<string>,
  now?: number,
  venueNames?: ReadonlyMap<string, string>,
): string[];

export function shoreditchCafeNames(rootDir: string): Map<string, string>;

export function shoreditchCafeIds(rootDir: string): Set<string>;
