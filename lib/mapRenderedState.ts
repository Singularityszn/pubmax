export type MapRenderedPriceBucket = 0 | 1 | 2 | 3;
export type MapRenderedPriceMeaning = "pint" | "type-relative" | "spoons";
export type MapRenderedPriceBand = Readonly<{
  meaning: MapRenderedPriceMeaning;
  bucket: MapRenderedPriceBucket;
}>;

export type MapRenderedState = Readonly<{
  priceBands: readonly MapRenderedPriceBand[];
  storyColour: string | null;
  /**
   * Whether any pin in the scene carries a figure a cluster disc can print
   * (`clusterPrice`). A coloured band does not imply one: a demo seed or a
   * type-relative band paints a pin without giving its disc a price.
   */
  clusterPrices: boolean;
}>;

export const EMPTY_MAP_RENDERED_STATE: MapRenderedState = {
  priceBands: [],
  storyColour: null,
  clusterPrices: false,
};

function isMapRenderedPriceBucket(
  value: unknown,
): value is MapRenderedPriceBucket {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function priceMeaning(
  kind: unknown,
): MapRenderedPriceMeaning | null {
  if (kind === "pub") return "pint";
  if (
    kind === "bar" ||
    kind === "club" ||
    kind === "food" ||
    kind === "restaurant"
  ) {
    return "type-relative";
  }
  return null;
}

export function deriveMapRenderedState<Tokens extends { brass: string }>(
  pubsData: GeoJSON.FeatureCollection,
  tokens: Tokens,
  storyColourToken: string | null,
): MapRenderedState {
  const renderedPairs = new Set(
    pubsData.features.flatMap((feature) => {
      // THE BAND ON THE GLASS IS THE ONE THE KEY HAS TO EXPLAIN. A pin the
      // Spoons value lens painted carries its own band property, and what it
      // means is units in a £10 round rather than the price of a pint, so it
      // is read as its own meaning and never folded into a price one. The
      // property is absent on every pub while the lens is off, so the pint and
      // type-relative answers below are untouched.
      const spoonsBucket = feature.properties?.spoonsBucket;
      if (isMapRenderedPriceBucket(spoonsBucket)) return [`spoons:${spoonsBucket}`];
      const meaning = priceMeaning(feature.properties?.kind);
      const bucket = feature.properties?.bucket;
      return meaning !== null && isMapRenderedPriceBucket(bucket)
        ? [`${meaning}:${bucket}`]
        : [];
    }),
  );
  const priceBands = (["pint", "type-relative", "spoons"] as const).flatMap(
    (meaning) =>
      ([0, 1, 2, 3] as const).flatMap((bucket) =>
        renderedPairs.has(`${meaning}:${bucket}`)
          ? [{ meaning, bucket }]
          : [],
      ),
  );
  const tokenValue = storyColourToken
    ? Reflect.get(tokens, storyColourToken)
    : null;

  return {
    priceBands,
    storyColour:
      storyColourToken === null
        ? null
        : typeof tokenValue === "string" && tokenValue.trim()
          ? tokenValue
          : tokens.brass,
    clusterPrices: pubsData.features.some(
      (feature) => typeof feature.properties?.clusterPrice === "number",
    ),
  };
}

export function sameMapRenderedState(
  left: MapRenderedState,
  right: MapRenderedState,
): boolean {
  return (
    left.storyColour === right.storyColour &&
    left.clusterPrices === right.clusterPrices &&
    left.priceBands.length === right.priceBands.length &&
    left.priceBands.every(
      (band, index) =>
        band.meaning === right.priceBands[index]?.meaning &&
        band.bucket === right.priceBands[index]?.bucket,
    )
  );
}
