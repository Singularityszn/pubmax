export const RESTAURANT_PACK_DIR_NAME: string;
export const RESTAURANT_PACK_FILE_NAME: string;
export const RESTAURANT_PACK_VERSION: number;

type LayerManifest = {
  urlPrefix: string;
  shards: { id: string; count: number }[];
  countsByKind?: Record<string, number>;
};

export function restaurantRowsFromLayer(
  manifest: LayerManifest,
  readShard: (url: string) => Promise<unknown>,
): Promise<unknown[][]>;

export function restaurantPackBody(
  manifest: LayerManifest,
  rows: unknown[][],
): {
  version: number;
  kind: "restaurant";
  layer: string;
  license: string;
  attribution: string;
  count: number;
  venues: unknown[][];
};

export function writeLondonRestaurantPack(): Promise<void>;
