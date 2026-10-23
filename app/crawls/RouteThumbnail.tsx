// Tiny honest route-shape thumbnail for the /crawls cards (E4) and the invite page: the crawl's
// resolved stop coordinates as a normalised polyline in a square viewBox.
// Straight lines between stops — deliberately NOT a map, matching the
// "straight-line" honesty rule in lib/routeLegs. Renders nothing when fewer
// than 2 points exist (never fakes a shape). Strokes/fills use currentColor
// so the card's CSS color drives it in both themes with zero new tokens.

type RouteThumbnailProps = {
  /** Ordered stop coordinates in [lng, lat] (GeoJSON) order. */
  points: readonly [number, number][];
  className?: string;
  label?: string;
  /**
   * Stop numbers to print on the pins, one per point. When given, the pins grow
   * to hold the number so the shape reads against a numbered list beside it
   * (the invite page). Left out, the thumbnail stays the small unlabelled shape
   * the /crawls cards use.
   */
  stopNumbers?: readonly number[];
};

const VIEW = 100;
const PAD = 14;

export default function RouteThumbnail({
  points,
  className,
  label,
  stopNumbers,
}: RouteThumbnailProps) {
  if (points.length < 2) return null;

  // Equirectangular normalisation: scale longitude by cos(mid-latitude) so a
  // route's proportions survive the degrees→pixels squash at London latitudes,
  // then fit the larger span into the padded square (uniform scale, centred on
  // the shorter axis) with Y flipped (north up).
  const midLat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const xsRaw = points.map((p) => p[0] * lngScale);
  const ysRaw = points.map((p) => p[1]);
  const minX = Math.min(...xsRaw);
  const maxX = Math.max(...xsRaw);
  const minY = Math.min(...ysRaw);
  const maxY = Math.max(...ysRaw);
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6;
  const inner = VIEW - PAD * 2;
  const xOffset = (span - (maxX - minX)) / 2;
  const yOffset = (span - (maxY - minY)) / 2;
  const coords = points.map((p): [number, number] => [
    PAD + ((p[0] * lngScale - minX + xOffset) / span) * inner,
    PAD + ((maxY - p[1] + yOffset) / span) * inner,
  ]);
  // Numbered pins are 14 units across. Two stops closer than that would paint one
  // pin over the other's number, so the two pins step apart until their numbers
  // can both be read, and every pin stays whole inside the frame. The line still
  // joins the true points.
  const pinCoords: [number, number][] = coords.map(([x, y]) => [x, y]);
  if (stopNumbers) {
    const MIN_GAP = 15;
    const PIN_R = 7;
    const inFrame = (v: number) => Math.min(VIEW - PIN_R, Math.max(PIN_R, v));
    for (let pass = 0; pass < 12; pass += 1) {
      let moved = false;
      for (let i = 1; i < pinCoords.length; i += 1) {
        for (let j = 0; j < i; j += 1) {
          const [xi, yi] = pinCoords[i]!;
          const [xj, yj] = pinCoords[j]!;
          const dist = Math.hypot(xi - xj, yi - yj);
          if (dist >= MIN_GAP - 0.01) continue;
          const ux = dist > 0.01 ? (xi - xj) / dist : Math.SQRT1_2;
          const uy = dist > 0.01 ? (yi - yj) / dist : Math.SQRT1_2;
          const push = (MIN_GAP - dist) / 2;
          pinCoords[i] = [inFrame(xi + ux * push), inFrame(yi + uy * push)];
          pinCoords[j] = [inFrame(xj - ux * push), inFrame(yj - uy * push)];
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
  const polylinePoints = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={className}
      role="img"
      aria-label={label ?? `Route shape: straight lines between ${points.length} stops`}
      preserveAspectRatio="xMidYMid meet"
    >
      <polyline
        points={polylinePoints}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.55}
      />
      {coords.map(([trueX, trueY], i) => {
        const [x, y] = stopNumbers ? pinCoords[i]! : [trueX, trueY];
        const stopNumber = stopNumbers?.[i];
        if (stopNumber === undefined) {
          return (
            <circle
              // Coordinate pairs can repeat (out-and-back routes); index keys a static list.
              key={`${x}-${y}-${i}`}
              cx={x}
              cy={y}
              r={i === 0 || i === coords.length - 1 ? 4 : 2.6}
              fill="currentColor"
            />
          );
        }
        return (
          <g key={`${x}-${y}-${i}`} aria-hidden="true">
            <circle cx={x} cy={y} r={7} fill="currentColor" />
            <text
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={8}
              fontWeight={700}
              className="routeThumbnailNumber"
            >
              {stopNumber}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
