export function inGreaterLondon(lat: number, lng: number): boolean;

export type AppDatasetIndex = {
  seq: number;
  isDuplicate(osmId: string, name: string, lat: number, lng: number): boolean;
  add(osmId: string, name: string, lat: number, lng: number): void;
};

export function indexAppDataset(app: Array<Record<string, unknown>>): AppDatasetIndex;

export function osmDatasetRow(input: {
  seq: number;
  pub: Record<string, unknown>;
  borough: string;
  fetchedAt: string;
  attribution: string;
  dataset: string;
  label: string;
}): Record<string, unknown> & {
  app_price_id: string;
  price_gbp: null;
  website: string;
  comment: string;
  data_quality_notes: string;
};

