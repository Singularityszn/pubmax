// A static, hand-drawn-feeling map motif: the Thames curve through central
// London with a few labelled pub pins. No MapLibre — this is a fast, decorative
// field-guide graphic that inherits the app's colour tokens.
export default function ThamesHero() {
  // Each pin carries a drink-category colour token (--cat-*) so the river reads
  // as a spread of drink families, not one brass dot repeated. The colour is
  // decoration on a pin that already has a name + price label beneath it, so it
  // never encodes meaning by colour alone (WCAG 1.4.1).
  const pins: {
    x: number;
    y: number;
    label: string;
    price: string;
    cat: string;
  }[] = [
    { x: 132, y: 118, label: "The Dove", price: "£4.20", cat: "beer" },
    { x: 236, y: 196, label: "The Mayflower", price: "£5.10", cat: "gin" },
    {
      x: 352,
      y: 132,
      label: "Ye Olde Cheshire Cheese",
      price: "£4.60",
      cat: "rum",
    },
    {
      x: 452,
      y: 214,
      label: "The Prospect of Whitby",
      price: "£5.40",
      cat: "wine",
    },
  ];

  return (
    <svg
      className="thamesHero"
      viewBox="0 0 560 340"
      role="img"
      aria-label="An illustrated map of central London showing the River Thames curving through the city, marked with four pub pins and their pint prices."
      preserveAspectRatio="xMidYMid meet"
    >
      {/* faint guidebook grid */}
      <defs>
        <pattern id="thamesGrid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M28 0H0V28" fill="none" stroke="var(--line-soft)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="560" height="340" fill="url(#thamesGrid)" />

      {/* the river — a wide soft channel with a darker centre line */}
      <path
        className="thamesBank"
        d="M-20 74 C 90 60, 150 132, 240 150 S 360 120, 430 176 S 540 250, 600 232"
        fill="none"
        stroke="var(--river)"
        strokeOpacity="0.16"
        strokeWidth="34"
        strokeLinecap="round"
      />
      <path
        className="thamesLine"
        d="M-20 74 C 90 60, 150 132, 240 150 S 360 120, 430 176 S 540 250, 600 232"
        fill="none"
        stroke="var(--river)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="1400"
        strokeDashoffset="1400"
      />

      {/* a suggested crawl route between pins */}
      <path
        className="crawlRoute"
        d="M132 118 L236 196 L352 132 L452 214"
        fill="none"
        stroke="var(--brass)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="6 7"
      />

      {/* river label */}
      <text
        x="70"
        y="66"
        fill="var(--river)"
        fontFamily="var(--serif)"
        fontStyle="italic"
        fontWeight="600"
        fontSize="15"
        opacity="0.8"
      >
        River Thames
      </text>

      {pins.map((pin, i) => (
        <g key={pin.label} className="mapPin" style={{ ["--pin-i" as string]: i }}>
          {/* pin drop shape — the outer teardrop takes the pin's category hue so
              the river reads as a spread of drink families. */}
          <path
            d={`M${pin.x} ${pin.y - 26} C ${pin.x - 11} ${pin.y - 26} ${pin.x - 13} ${pin.y - 12} ${pin.x} ${pin.y} C ${pin.x + 13} ${pin.y - 12} ${pin.x + 11} ${pin.y - 26} ${pin.x} ${pin.y - 26} Z`}
            fill={`var(--cat-${pin.cat})`}
          />
          <circle cx={pin.x} cy={pin.y - 18} r="4.5" fill="var(--panel-raised)" />
          {/* price tag */}
          <g transform={`translate(${pin.x + 10}, ${pin.y - 34})`}>
            <rect
              width="46"
              height="21"
              rx="5"
              fill="var(--panel-raised)"
              stroke="var(--line)"
            />
            <text
              x="23"
              y="14.5"
              textAnchor="middle"
              fill="var(--pint)"
              fontFamily="var(--serif)"
              fontSize="12"
              fontWeight="600"
            >
              {pin.price}
            </text>
          </g>
          {/* pub name */}
          <text
            x={pin.x}
            y={pin.y + 18}
            textAnchor="middle"
            fill="var(--ink-soft)"
            fontFamily="var(--serif)"
            fontWeight="600"
            fontSize="11.5"
          >
            {pin.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
