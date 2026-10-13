export function importReviewedDrinkPrices(inputPath: string, options: {
  expectedSha256: string;
  sourcePdfPath: string;
  scratchDir?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{
  written: boolean;
  addedRows: number;
  totalRows: number;
  generatedAt?: string;
  inputSha256?: string;
  sourcePdfSha256?: string;
  paths?: string[];
  permissions: Array<{ url: string; allowed: boolean; reason?: string }>;
}>;
