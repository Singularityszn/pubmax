"use client";

// Your add link as a QR code, for a mate across the table to scan.

import { encode } from "uqr";

// A scanner needs dark modules on a light plate, so the code keeps these two
// colours in both themes, as an image would.
const PLATE = "#ffffff";
const MODULE = "#111111";
const QUIET = 4;

/** One path of horizontal runs, so a 29 by 29 code is a few hundred commands, not 800 rects. */
function modulePath(rows: readonly (readonly boolean[])[]): string {
  let path = "";
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      path += `M${start + QUIET} ${y + QUIET}h${x - start}v1h${start - x}z`;
    }
  });
  return path;
}

export default function AddLinkQr({ url }: { url: string }) {
  const { data, size } = encode(url, { ecc: "M", border: 0 });
  const box = size + QUIET * 2;
  return (
    <svg
      className="confirmFollowQr"
      viewBox={`0 0 ${box} ${box}`}
      role="img"
      aria-label="QR code for your add link"
      shapeRendering="crispEdges"
    >
      <rect width={box} height={box} fill={PLATE} />
      <path d={modulePath(data)} fill={MODULE} />
    </svg>
  );
}
