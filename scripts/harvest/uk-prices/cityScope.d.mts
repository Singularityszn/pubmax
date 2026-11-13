export type HarvestCityScope = {
  ids: string[];
  contains: (point: { lat?: unknown; lng?: unknown }) => boolean;
};

export function harvestCityScope(ids: readonly string[]): HarvestCityScope | null;

export function hostsTouchingCityScope<T extends { pubs: ReadonlyArray<{ lat?: unknown; lng?: unknown }> }>(
  hosts: readonly T[],
  scope: Pick<HarvestCityScope, "contains">,
): { hosts: T[]; hostsOutsideScope: number };
