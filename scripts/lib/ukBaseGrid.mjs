// The fixed grid the UK base-pub layer is sharded on, and the pure cell maths
// the build script uses. BUILD-SIDE ONLY: the client never derives a cell — it
// reads the manifest the build emits and intersects bboxes (lib/ukBasePubs.ts),
// so this grid can be re-cut without shipping a second copy of it to the phone.
//
// Cell size is chosen against the render gate, not the data: at UK_BASE_MIN_ZOOM
// a 390x844 phone viewport is roughly 7 x 16 km, so a ~28 x ~17 km cell means a
// pan usually needs one new file and never a wide fan-out, while keeping the
// cell count (and therefore the manifest) small enough to fetch in one go.

export const SHARD_DIR_NAME = "uk_base";
export const UK_BASE_SHARD_VERSION = 1;

// Origin sits just outside the pack's bbox ([49.8, -8.7, 61, 1.9]) on both axes
// so cell boundaries are stable numbers and no pub lands on a negative index.
export const UK_BASE_GRID = {
  originLat: 49.75,
  originLon: -8.75,
  latStep: 0.25,
  lonStep: 0.25,
};

export function cellIndexFor(lat, lon) {
  return {
    latIndex: Math.floor((lat - UK_BASE_GRID.originLat) / UK_BASE_GRID.latStep),
    lonIndex: Math.floor((lon - UK_BASE_GRID.originLon) / UK_BASE_GRID.lonStep),
  };
}

/** South-west corner of a cell, formatted — also its file name and manifest id. */
export function cellKey(latIndex, lonIndex) {
  const lat = UK_BASE_GRID.originLat + latIndex * UK_BASE_GRID.latStep;
  const lon = UK_BASE_GRID.originLon + lonIndex * UK_BASE_GRID.lonStep;
  return `${lat.toFixed(2)}_${lon.toFixed(2)}`;
}

/** [minLng, minLat, maxLng, maxLat] — GeoJSON bbox order, as the manifest wants. */
export function cellBbox(latIndex, lonIndex) {
  const minLat = UK_BASE_GRID.originLat + latIndex * UK_BASE_GRID.latStep;
  const minLon = UK_BASE_GRID.originLon + lonIndex * UK_BASE_GRID.lonStep;
  return [
    Number(minLon.toFixed(4)),
    Number(minLat.toFixed(4)),
    Number((minLon + UK_BASE_GRID.lonStep).toFixed(4)),
    Number((minLat + UK_BASE_GRID.latStep).toFixed(4)),
  ];
}
