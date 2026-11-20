export function validateCityPackRow(
  cityId: string,
  row: unknown,
  ids: Set<string>,
  bounds: { latMin: number; lonMin: number; latMax: number; lonMax: number },
): string[];
export function validateCityVenuePacks(): { ok: boolean; count: number };
