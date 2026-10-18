export const FOOD_PACK_DIR_NAME: string;
export const FOOD_PACK_FILE_NAME: string;
export const FOOD_PACK_VERSION: number;

type LayerManifest = {
  urlPrefix: string;
  shards: { id: string; count: number }[];
  countsByKind?: Record<string, number>;
};

export function foodRowsFromLayer(
  manifest: LayerManifest,
  readShard: (url: string) => Promise<unknown>,
): Promise<unknown[][]>;

export function foodPackBody(
  manifest: LayerManifest,
  rows: unknown[][],
): {
  version: number;
  kind: "food";
  layer: string;
  license: string;
  attribution: string;
  count: number;
  venues: unknown[][];
};

export function writeLondonFoodPack(): Promise<void>;
