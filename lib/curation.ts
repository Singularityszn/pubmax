import type { VenuePrice } from "@/lib/venues";

// Every heritage/story claim carries where it came from, so the UI can always
// show a Sourced / Contributor / Anecdote badge and the two never blur.
export type Provenance = "sourced" | "contributor" | "anecdote";

// A claim is one labelled, provenance-stamped statement about a venue. The
// venue detail renders the whole list — a Sourced editorial claim and an
// Anecdote Pint Drop are separate entries and never merge into one note.
export type ClaimKind =
  | "baseline"
  | "sourced"
  | "contributor"
  | "anecdote"
  | "needs-source";

export type VenueClaim = {
  kind: ClaimKind;
  label: string;
  content: string;
  sourceRef?: string;
  era?: string;
};

// Structural shape of a Pint Drop as buildVenueClaims needs it. Kept local so
// curation.ts stays free of lib/pintDrops (which imports node `crypto`).
export type ClaimDrop = {
  handle: string;
  drink: string;
  priceGbp: number | null;
  passedDownNote: string;
  era: string;
  provenance: Provenance;
};

export type VenueCuration = {
  nearWater?: boolean;
  heritageEra?: string;
  heritageNote?: string;
  writerPick?: boolean;
  storyTag?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  provenance?: Provenance;
};

export type PubSource = {
  title: string;
  detail: string;
  url: string;
};

export const writerProfile = {
  name: "Alastair Hilton",
  handle: "@London_W4",
  role: "London photographer, narrowboat resident, historic pub walker",
  bookTitle: "The Greatest Pubs",
  bookUrl: "https://www.alastairhiltonphotographer.com/product-page/the-greatest-pubs",
  xUrl: "https://x.com/London_W4",
  summary:
    "A photographer-led view of pubs: what they look like, why they are loved, and why people should still visit them.",
  proofPoints: [
    "The book is a 156-page signed hardback covering 44 pubs.",
    "His guide profiles describe private historic London pub tours with stories and history facts.",
    "His shop includes pub prints such as The City Barge, The Grapes, The Sun Tavern, and The Queens.",
  ],
};

export const pubSources: PubSource[] = [
  {
    title: "The Greatest Pubs",
    detail: "Book by Alastair Hilton: 156 pages, 44 pubs, photos and personal notes.",
    url: writerProfile.bookUrl,
  },
  {
    title: "London_W4 on X",
    detail: "Public profile used for the writer identity and current pub commentary.",
    url: writerProfile.xUrl,
  },
  {
    title: "Historic pub tours",
    detail: "Guide profile describing Alastair's historic London pub walks.",
    url: "https://camdenguidedwalks.co.uk/london-tour-guide-alastair.php",
  },
];

export const writerTrail = [
  "The City Barge",
  "The Grapes",
  "The Sun Tavern",
  "The Queens",
];

const curatedVenues: Record<string, VenueCuration> = {
  "prospect of whitby": {
    nearWater: true,
    heritageEra: "Tudor",
    heritageNote:
      "Riverside Wapping pub usually dated to 1520; a strong fit for the heritage-by-water demo.",
    storyTag: "Old riverside London",
  },
  "the grapes": {
    nearWater: true,
    heritageEra: "Georgian riverside",
    heritageNote:
      "Limehouse pub on Narrow Street with a long river-facing history and a visible place in Hilton's pub print shop.",
    writerPick: true,
    storyTag: "Hilton print trail",
    sourceLabel: "The Grapes print",
    sourceUrl: "https://www.alastairhiltonphotographer.com/product-page/the-grapes",
  },
  "the dove": {
    nearWater: true,
    heritageEra: "Georgian",
    heritageNote:
      "Upper Mall riverside pub in Hammersmith; useful as a west London water-side heritage stop.",
    storyTag: "Thames-side room",
  },
  "the old pack horse": {
    heritageEra: "Edwardian",
    heritageNote:
      "Chiswick High Road pub noted for its Edwardian exterior and strong local character.",
    storyTag: "Chiswick landmark",
  },
  "the lamb": {
    heritageEra: "Victorian",
    heritageNote:
      "Victorian Bloomsbury pub with the kind of preserved interior detail that suits a heritage crawl.",
    storyTag: "Victorian room",
  },
  "the sun tavern": {
    heritageEra: "East End",
    heritageNote:
      "Bethnal Green pub included in Hilton's visible pub print shop, useful for a writer-inspired crawl seed.",
    writerPick: true,
    storyTag: "Hilton print trail",
    sourceLabel: "All Products - Alastair Hilton",
    sourceUrl: "https://www.alastairhiltonphotographer.com/category/all-products",
  },
  "the queens head": {
    heritageEra: "Victorian",
    heritageNote:
      "One of the app's closest matches for Hilton's visible The Queens print; keep as a soft match until the exact pub is verified.",
    writerPick: true,
    storyTag: "Possible Queens match",
    sourceLabel: "The Queens print",
    sourceUrl: "https://www.alastairhiltonphotographer.com/product-page/the-queens",
  },
  "the queens arms": {
    heritageEra: "Victorian",
    heritageNote:
      "Pimlico pub from 1846; a useful Victorian reference stop for the seeded heritage route.",
    storyTag: "Victorian pub",
  },
};

const waterTerms = [
  "riverside",
  "river",
  "thames",
  "strand-on-the-green",
  "strand on the green",
  "wapping wall",
  "narrow st",
  "narrow street",
  "upper mall",
  "wharf",
  "dock",
  "canal",
  "waterside",
];

// Strong period signals only. "historic"/"traditional"/"cool" were removed —
// they appear in most pub blurbs and flooded the map with fake heritage badges.
const heritageTerms = [
  "victorian",
  "georgian",
  "edwardian",
  "tudor",
  "grade ii listed",
  "grade i listed",
  "oldest pub",
  "dating back",
  "since 18",
  "since 17",
  "since 16",
];

export function normaliseVenueName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getVenueCuration(prices: VenuePrice[]): VenueCuration {
  const first = prices[0];
  const explicit = curatedVenues[normaliseVenueName(first.pub_name)] ?? {};
  const haystack = [
    first.pub_name,
    first.address,
    first.description,
    ...prices.map((price) => price.comment),
  ]
    .join(" ")
    .toLowerCase();

  const nearWater =
    explicit.nearWater ?? waterTerms.some((term) => haystack.includes(term));

  // Hand-curated entries are checked editorial → sourced. Keyword matches are a
  // weak hint that still needs a human or a visitor Pint Drop → anecdote, never sourced.
  const hasExplicitHeritage =
    typeof explicit.heritageEra === "string" || typeof explicit.heritageNote === "string";
  const inferredHeritage =
    !hasExplicitHeritage && heritageTerms.some((term) => haystack.includes(term));

  const provenance: Provenance | undefined =
    explicit.writerPick || hasExplicitHeritage || explicit.sourceUrl
      ? "sourced"
      : inferredHeritage
        ? "anecdote"
        : undefined;

  return {
    ...explicit,
    nearWater,
    provenance,
    heritageEra: explicit.heritageEra ?? (inferredHeritage ? "Historic (unverified)" : undefined),
    heritageNote:
      explicit.heritageNote ??
      (inferredHeritage
        ? "The venue's own description hints at period features. Unverified — a sourced note or a visitor Pint Drop can confirm it."
        : undefined),
  };
}

// Build the distinct, provenance-stamped claim list for a venue. Nothing here
// collapses: an editorial Sourced heritage claim and a note-only Anecdote drop
// BOTH appear as separate entries. A heritage note without a source ref is
// downgraded to "needs-source" so it is never mistaken for verified editorial.
export function buildVenueClaims(curation: VenueCuration, drops: ClaimDrop[] = []): VenueClaim[] {
  const claims: VenueClaim[] = [];

  if (curation.heritageNote) {
    const hasSource = Boolean(curation.sourceUrl) || curation.writerPick;
    claims.push({
      kind: hasSource ? "sourced" : "needs-source",
      label: hasSource ? curation.sourceLabel ?? "Editorial" : "Needs source",
      content: curation.heritageNote,
      sourceRef: curation.sourceUrl,
      era: curation.heritageEra,
    });
  }

  for (const drop of drops) {
    const priced = typeof drop.priceGbp === "number";
    const content =
      drop.passedDownNote ||
      (priced ? `Logged ${drop.drink || "a pint"} at £${drop.priceGbp!.toFixed(2)}.` : "");
    if (!content) continue;
    claims.push({
      kind: priced ? "contributor" : "anecdote",
      label: drop.handle || (priced ? "Contributor" : "Anecdote"),
      content,
      era: drop.era || undefined,
    });
  }

  return claims;
}
