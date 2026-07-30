type PubsSource = {
  setData: (data: GeoJSON.FeatureCollection) => Promise<void>;
};

type CommitPubsSourceRevisionOptions = {
  data: GeoJSON.FeatureCollection;
  source: PubsSource;
  invalidatePaint: () => void;
  isCurrent: () => boolean;
  publish: (data: GeoJSON.FeatureCollection) => void;
};

/**
 * Commits one authoritative pubs source revision across cluster paint and key.
 *
 * Old desktop donuts retire before MapLibre starts replacement work. Key state
 * publishes only after that exact GeoJSON revision settles in MapLibre, and a
 * superseded worker completion cannot publish stale meaning.
 */
export async function commitPubsSourceRevision({
  data,
  source,
  invalidatePaint,
  isCurrent,
  publish,
}: CommitPubsSourceRevisionOptions): Promise<void> {
  invalidatePaint();
  await source.setData(data);
  if (isCurrent()) publish(data);
}
