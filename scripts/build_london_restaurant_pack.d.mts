export const RESTAURANT_PACK_DIR_NAME: string;
export const RESTAURANT_PACK_FILE_NAME: string;
export const RESTAURANT_PACK_VERSION: number;

type LayerManifest = {
  urlPrefix: string;
  shards: { id: string; count: number }[];
  countsByKind?: Record<string, number>;
  restaurantSnapshot?: { fetchedAt: string };
};

export function restaurantRowsFromLayer(
  manifest: LayerManifest,
  readShard: (url: string) => Promise<unknown>,
): Promise<unknown[][]>;

export function kindRowsFromLayer(
  manifest: LayerManifest,
  readShard: (url: string) => Promise<unknown>,
  kind: string,
): Promise<unknown[][]>;

export function restaurantPackBody(
  manifest: LayerManifest,
  rows: unknown[][],
  facts?: ReadonlyMap<unknown, { cuisine?: string | null; openingHours?: string | null }>,
): {
  version: number;
  kind: "restaurant";
  layer: string;
  license: string;
  attribution: string;
  observedAt: string | null;
  count: number;
  venues: unknown[][];
};

export function writeLondonRestaurantPack(): Promise<void>;
