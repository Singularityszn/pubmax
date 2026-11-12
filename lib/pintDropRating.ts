export type PintDropRating = 1 | 2 | 3 | 4 | 5;

export function isPintDropRating(value: unknown): value is PintDropRating {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export const PINT_DROP_STARS_NOT_SAVED = "Your Pint Drop is saved, but the stars were not saved.";
