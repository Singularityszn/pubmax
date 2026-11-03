import type { DrinkMeasure } from "./drinkMeasure";

export const NON_PINT_MEASURE_PATTERNS: ReadonlyArray<{
  readonly word: string;
  readonly measure: Exclude<DrinkMeasure, "pint">;
}>;
export function measureNamedInDrinkText(text: unknown): Exclude<DrinkMeasure, "pint"> | null;
