export type EstimatePoint = { id: string; lat: number; lng: number; priceGbp?: number; locality?: string | null; postcode?: string | null };
export type BuiltEstimate = { priceGbp: number; basis: "nearby" | "locality" | "postcode_area"; sampleSize: number; detail: string | number };
export function buildUkEstimateModel(samples: readonly EstimatePoint[]): (pub: EstimatePoint) => BuiltEstimate | null;
