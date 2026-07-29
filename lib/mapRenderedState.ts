export type MapRenderedPriceBucket = 0 | 1 | 2 | 3;
export type MapRenderedPriceMeaning = "pint" | "type-relative";

export type MapRenderedState = Readonly<{
  priceBuckets: readonly MapRenderedPriceBucket[];
  priceMeanings: readonly MapRenderedPriceMeaning[];
  storyColour: string | null;
}>;

export const EMPTY_MAP_RENDERED_STATE: MapRenderedState = {
  priceBuckets: [],
  priceMeanings: [],
  storyColour: null,
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
  if (kind === "bar" || kind === "food" || kind === "restaurant") {
    return "type-relative";
  }
  return null;
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
  const renderedPriceMeanings = new Set(
    pubsData.features
      .map((feature) => priceMeaning(feature.properties?.kind))
      .filter(
        (meaning): meaning is MapRenderedPriceMeaning => meaning !== null,
      ),
  );
  const priceMeanings = (["pint", "type-relative"] as const).filter(
    (meaning) => renderedPriceMeanings.has(meaning),
  );
  const tokenValue = storyColourToken
    ? Reflect.get(tokens, storyColourToken)
    : null;

  return {
    priceBuckets,
    priceMeanings,
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
    ) &&
    left.priceMeanings.length === right.priceMeanings.length &&
    left.priceMeanings.every(
      (meaning, index) => meaning === right.priceMeanings[index],
    )
  );
}
