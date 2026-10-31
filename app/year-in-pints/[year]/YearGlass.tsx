import { daysThroughMonth, yearDotGlass } from "@/lib/yearInPintsDotGlass";

// The shared year's pint glass (lib/yearInPintsDotGlass.ts owns the rules):
// one dot per day, lit one per night out. The tones are classes, so the page's
// own tokens paint them in both themes (yearInPints.css). The picture repeats
// what the nights line already says, so its label says it in words too.

export default function YearGlass({ year, through, nights }: { year: number; through: number; nights: number }) {
  const glass = yearDotGlass({ year, through, nights, width: 160, height: 272 });
  const r = glass.spacing * 0.36;
  const days = daysThroughMonth(year, through);
  const lit = Math.min(nights, days);
  return (
    <figure className="yipGlass" data-testid="year-share-glass">
      <svg
        role="img"
        aria-label={`A pint glass of ${glass.dots.length} dots, one for each day of ${year}. ${lit} of the first ${days} are lit, one for each night out.`}
        width={glass.width}
        height={glass.height}
        viewBox={`0 0 ${glass.width} ${glass.height}`}
      >
        {glass.dots.map((dot) => (
          <circle key={`${dot.x}-${dot.y}`} className={`yipGlassDot yipGlassDot--${dot.tone}`} cx={dot.x} cy={dot.y} r={r} />
        ))}
      </svg>
      <figcaption className="yipNote">Each dot is a day. Lit: a night out.</figcaption>
    </figure>
  );
}
