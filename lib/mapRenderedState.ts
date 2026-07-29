export type MapRenderedPriceBucket = 0 | 1 | 2 | 3;

export type MapRenderedState = Readonly<{
  priceBuckets: readonly MapRenderedPriceBucket[];
  storyColour: string | null;
}>;

export const EMPTY_MAP_RENDERED_STATE: MapRenderedState = {
  priceBuckets: [],
  storyColour: null,
};

function isMapRenderedPriceBucket(
  value: unknown,
): value is MapRenderedPriceBucket {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export function deriveMapRenderedState<Tokens extends { brass: string }>(
  pubsData: GeoJSON.FeatureCollection,
  tokens: Tokens,
  storyColourToken: string | null,
): MapRenderedState {
  const priceBuckets = Array.from(
    new Set(
      pubsData.features
        .map((feature) => feature.properties?.bucket)
        .filter(isMapRenderedPriceBucket),
    ),
  ).sort((left, right) => left - right);
  const tokenValue = storyColourToken
    ? Reflect.get(tokens, storyColourToken)
    : null;

  return {
    priceBuckets,
    storyColour:
      storyColourToken === null
        ? null
        : typeof tokenValue === "string" && tokenValue.trim()
          ? tokenValue
          : tokens.brass,
  };
}

export function sameMapRenderedState(
  left: MapRenderedState,
  right: MapRenderedState,
): boolean {
  return (
    left.storyColour === right.storyColour &&
    left.priceBuckets.length === right.priceBuckets.length &&
    left.priceBuckets.every(
      (bucket, index) => bucket === right.priceBuckets[index],
    )
  );
}
