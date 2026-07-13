// Curated crawl-ending options. This stays deliberately separate from the
// Venue Dataset: late-food suitability is not a pint-price or crawl-stop fact.
// The seed is keyless and static so callers can always offer an honest ending.

export const LATE_FOOD_AREAS = [
  "clapham",
  "victoria",
  "piccadilly-soho",
  "canary-wharf",
  "barnes",
  "chiswick",
] as const;

export type LateFoodArea = (typeof LATE_FOOD_AREAS)[number];

/** Accepted URL aliases that normalize to a canonical Night Area slug. */
export const LATE_FOOD_AREA_ALIASES = {
  soho: "piccadilly-soho",
  piccadilly: "piccadilly-soho",
} as const satisfies Record<string, LateFoodArea>;

export const LATE_FOOD_CATEGORIES = [
  "kebab",
  "pizza",
  "cafe",
  "restaurant",
] as const;

export type LateFoodCategory = (typeof LATE_FOOD_CATEGORIES)[number];
export type LateFoodDietary = "vegan" | "vegetarian" | "gluten-free";
export type LateFoodConfidence = "high" | "medium" | "low";

export type LateFoodHours = {
  /** Human-readable late-service guidance, not a live opening-hours feed. */
  service: string;
  /** The static seed is intentionally conservative: callers must verify tonight. */
  verifyOnNight: true;
};

export type LateFoodProvenance = {
  kind: "editorial";
  source: string;
  reviewedAt: string;
};

export type LateFoodWalkingDetour = {
  /** Typical extra walking time from the Night Area's central crawl cluster. */
  minutes: number;
  note: string;
};

/**
 * A food-only crawl ending. It intentionally has no venue ID, pint prices,
 * amenities, or coordinates, so it cannot be passed into venue route scoring.
 */
export type LateFoodTerminal = {
  id: string;
  name: string;
  area: LateFoodArea;
  category: LateFoodCategory;
  dietary: LateFoodDietary[];
  hours: LateFoodHours;
  walkingDetour: LateFoodWalkingDetour;
  provenance: LateFoodProvenance;
  confidence: LateFoodConfidence;
};

/** Successful /api/late-food payload, ready for mobile UI consumption. */
export type LateFoodApiSuccessResponse = {
  area: LateFoodArea;
  terminals: LateFoodTerminal[];
  rankingSignals: string[];
  missingEvidence: string[];
};

/** Invalid /api/late-food request payload; terminals is always explicitly empty. */
export type LateFoodApiErrorResponse = {
  error: string;
  terminals: [];
};

export type LateFoodApiResponse = LateFoodApiSuccessResponse | LateFoodApiErrorResponse;

const STATIC_PROVENANCE: LateFoodProvenance = {
  kind: "editorial",
  source: "PubMax London Capture static curation",
  reviewedAt: "2026-07-13",
};

const HOURS_TO_VERIFY: LateFoodHours = {
  service: "Late-service suitability is curated; confirm tonight's kitchen hours before heading over.",
  verifyOnNight: true,
};

export const LATE_FOOD_TERMINALS: readonly LateFoodTerminal[] = [
  {
    id: "late-food-clapham-kebab-corner",
    name: "Kebab Corner",
    area: "clapham",
    category: "kebab",
    dietary: ["vegetarian"],
    hours: HOURS_TO_VERIFY,
    walkingDetour: { minutes: 4, note: "Short detour from Clapham High Street." },
    provenance: STATIC_PROVENANCE,
    confidence: "medium",
  },
  {
    id: "late-food-clapham-joe-public",
    name: "Joe Public",
    area: "clapham",
    category: "pizza",
    dietary: ["vegetarian"],
    hours: HOURS_TO_VERIFY,
    walkingDetour: { minutes: 6, note: "Short detour from Clapham Common station." },
    provenance: STATIC_PROVENANCE,
    confidence: "medium",
  },
  {
    id: "late-food-victoria-the-athenian",
    name: "The Athenian",
    area: "victoria",
    category: "restaurant",
    dietary: ["vegetarian"],
    hours: HOURS_TO_VERIFY,
    walkingDetour: { minutes: 5, note: "Near Victoria station for an easy onward journey." },
    provenance: STATIC_PROVENANCE,
    confidence: "medium",
  },
  {
    id: "late-food-piccadilly-soho-bar-italia",
    name: "Bar Italia",
    area: "piccadilly-soho",
    category: "cafe",
    dietary: ["vegetarian"],
    hours: HOURS_TO_VERIFY,
    walkingDetour: { minutes: 4, note: "In the Soho core, close to the final crawl stop cluster." },
    provenance: STATIC_PROVENANCE,
    confidence: "high",
  },
  {
    id: "late-food-piccadilly-soho-balans",
    name: "Balans Soho",
    area: "piccadilly-soho",
    category: "restaurant",
    dietary: ["vegan", "vegetarian", "gluten-free"],
    hours: HOURS_TO_VERIFY,
    walkingDetour: { minutes: 5, note: "A short walk from Piccadilly Circus." },
    provenance: STATIC_PROVENANCE,
    confidence: "medium",
  },
  {
    id: "late-food-canary-wharf-big-easy",
    name: "Big Easy Canary Wharf",
    area: "canary-wharf",
    category: "restaurant",
    dietary: ["vegetarian", "gluten-free"],
    hours: HOURS_TO_VERIFY,
    walkingDetour: { minutes: 7, note: "Inside the Canary Wharf estate." },
    provenance: STATIC_PROVENANCE,
    confidence: "medium",
  },
  {
    id: "late-food-canary-wharf-royal-china",
    name: "Royal China Club",
    area: "canary-wharf",
    category: "restaurant",
    dietary: ["vegetarian"],
    hours: HOURS_TO_VERIFY,
    walkingDetour: { minutes: 8, note: "A short walk east of the main station cluster." },
    provenance: STATIC_PROVENANCE,
    confidence: "medium",
  },
  {
    id: "late-food-barnes-rick-stein",
    name: "Rick Stein Barnes",
    area: "barnes",
    category: "restaurant",
    dietary: ["vegetarian", "gluten-free"],
    hours: HOURS_TO_VERIFY,
    walkingDetour: { minutes: 6, note: "Near Barnes village and the riverside crawl cluster." },
    provenance: STATIC_PROVENANCE,
    confidence: "low",
  },
  {
    id: "late-food-chiswick-lavinia",
    name: "Lavinia's",
    area: "chiswick",
    category: "restaurant",
    dietary: ["vegan", "vegetarian"],
    hours: HOURS_TO_VERIFY,
    walkingDetour: { minutes: 5, note: "Close to Chiswick High Road." },
    provenance: STATIC_PROVENANCE,
    confidence: "low",
  },
];

export function isLateFoodArea(value: string): value is LateFoodArea {
  return (LATE_FOOD_AREAS as readonly string[]).includes(value);
}

/**
 * Normalizes user-facing area labels before querying the static catalogue.
 * Responses always use canonical Night Area slugs.
 */
export function normalizeLateFoodArea(value: string | null | undefined): LateFoodArea | null {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return null;

  if (Object.hasOwn(LATE_FOOD_AREA_ALIASES, candidate)) {
    return LATE_FOOD_AREA_ALIASES[candidate as keyof typeof LATE_FOOD_AREA_ALIASES];
  }

  return isLateFoodArea(candidate) ? candidate : null;
}

export function getLateFoodForArea(area: LateFoodArea, tags: readonly string[] = []): LateFoodTerminal[] {
  const normalizedTags = tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
  return LATE_FOOD_TERMINALS
    .filter((terminal) => terminal.area === area)
    .filter((terminal) => {
      if (normalizedTags.length === 0) return true;
      return normalizedTags.some((tag) =>
        terminal.category === tag ||
        terminal.dietary.includes(tag as LateFoodDietary) ||
        terminal.name.toLowerCase().includes(tag)
      );
    })
    .sort((a, b) => {
      const confidence = { high: 3, medium: 2, low: 1 } satisfies Record<LateFoodConfidence, number>;
      return confidence[b.confidence] - confidence[a.confidence] || a.walkingDetour.minutes - b.walkingDetour.minutes;
    });
}
