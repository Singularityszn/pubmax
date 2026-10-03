/** Deploy revision used to cache-bust map venue packs (`?v=` on `/data/*`). */
export const MAP_DATA_REVISION =
  process.env.NEXT_PUBLIC_SW_VERSION?.trim() ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("A deploy revision is required for production map data");
      })()
    : "local");

// The revision match is a production cache-busting guard. `next dev` serves
// whatever packs public/data holds, committed `local`, restamped with HEAD or a
// mix, so outside production every pack is accepted.
export const EXPECTED_MAP_DATA_REVISION =
  process.env.NODE_ENV === "production" && MAP_DATA_REVISION !== "local"
    ? MAP_DATA_REVISION
    : undefined;
