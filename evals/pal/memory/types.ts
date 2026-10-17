import type { PubPalMemoryKind } from "@/lib/pubPal";

/** Where in the context a fact must sit. Each key matches the same line in either voice. */
export type PalMemoryLine =
  | "patches"
  | "regulars"
  | "loved"
  | "notKeen"
  | "drinks"
  | "price"
  | "vibes"
  | "wishlist"
  | "lastVisit";

/**
 * `must` gates the suite: the system promises to surface it today. `stretch`
 * is measured but never gates: it is what the Pal should remember and does
 * not yet, so its recall is the number that goes up as memory improves.
 */
type PalMemoryFactTier = "must" | "stretch";

type PalMemoryFact = {
  id: string;
  value: string;
  line?: PalMemoryLine;
  tier: PalMemoryFactTier;
  /** A phrase anyone's read may carry (a style, a weekday, a vibe), so it is never another person's leak. */
  generic?: boolean;
  /** Shorter ways a reply may say it (Soho for Piccadilly & Soho). Layer 2 only. */
  aliases?: string[];
};

type PalMemoryAbsent = { value: string; line?: PalMemoryLine; why: string };

/**
 * A question a person might ask, and the facts the Pal needs in front of it to
 * answer from memory. Layer 2 asks it of the live agent: `answer` (a quick
 * pick) must get an answer rather than only questions, `ask` (a plan, or a
 * quick pick with nothing to go on) must get one to three questions, and the
 * reply must use at least `minUsed` of `needs` (default 1 when `needs` is set).
 */
type PalMemoryProbe = { ask: string; needs: string[]; mode?: "answer" | "ask"; minUsed?: number };

export type PalMemoryPersona = {
  id: string;
  summary: string;
  userId: string;
  handle: string;
  /** Null: the account has no Pal, so it keeps every default. */
  pal: { taste: boolean } | null;
  memories: Array<{ kind: PubPalMemoryKind; value: string }>;
  diary: Array<{ venueId: string; visitedOn: string; rating: number | null }>;
  drops: Array<{
    venueId: string;
    day: string;
    drink: string;
    priceGbp: number | null;
    measure?: "pint" | "half" | "other";
    vibeTags: string[];
  }>;
  saved: string[];
  /** The whole context, line for line, when the persona pins it exactly. */
  exactContext?: string[];
  /** True when no line of the taste read may reach the model at all. */
  noTasteRead?: boolean;
  facts: PalMemoryFact[];
  absent: PalMemoryAbsent[];
  probes: PalMemoryProbe[];
};

export type PalMemorySuite = { version: 1; now: string; personas: PalMemoryPersona[] };

export type PalMemoryCheck = { name: string; pass: boolean; detail: string };

/** One surface's grade: typed chat's user message, or the voice recall answer. */
export type PalMemorySurfaceResult = {
  pass: boolean;
  mustFound: number;
  mustTotal: number;
  stretchFound: number;
  stretchTotal: number;
  /** Values that reached the model and must not have: another person's, an opted-out log, a stale rating. */
  leaks: string[];
  missing: string[];
  checks: PalMemoryCheck[];
  contextChars: number;
};

export type PalMemoryPersonaResult = {
  id: string;
  pass: boolean;
  typed: PalMemorySurfaceResult;
  voice: PalMemorySurfaceResult;
  probes: Array<{ ask: string; answerable: boolean; missing: string[] }>;
  /** The typed context as sent, for reading a failure. */
  context: string[];
};

export type PalMemoryScoreboard = {
  now: string;
  personas: PalMemoryPersonaResult[];
  totals: {
    pass: boolean;
    personas: number;
    mustRecall: number;
    stretchRecall: number;
    leaks: number;
    probesAnswerable: number;
    probes: number;
    avgContextChars: number;
  };
};

/** What a responder returns for one probe. A failed turn is graded as a miss, never skipped. */
export type PalMemoryReply = { ok: boolean; reply: string; latencyMs: number; toolsUsed: string[] };

/** Asks one probe as one persona. The live one is the production typed chat turn. */
export type PalMemoryResponder = (input: { ownerId: string; ask: string }) => Promise<PalMemoryReply>;

export type PalMemoryProbeUse = {
  persona: string;
  ask: string;
  reply: string;
  ok: boolean;
  pass: boolean;
  used: string[];
  unused: string[];
  /** Values the reply said that it had no business saying. */
  falseMemories: string[];
  modeCheck: { mode: "answer" | "ask"; pass: boolean; detail: string } | null;
  /** Whether layer 1 put every needed fact in front of the model. */
  answerable: boolean;
  /** Where a miss lies: the model ignored what it had, or it never had it. */
  blame: "none" | "model" | "retrieval";
  latencyMs: number;
  toolsUsed: string[];
};

export type PalMemoryUseScoreboard = {
  now: string;
  responder: string;
  probes: PalMemoryProbeUse[];
  totals: {
    pass: boolean;
    probes: number;
    passed: number;
    /** Needed facts the replies used, over all needed facts. */
    useRate: number;
    falseMemories: number;
    modeChecks: number;
    modePassed: number;
    failedTurns: number;
    blamedOnModel: number;
    blamedOnRetrieval: number;
    latencyMsP50: number;
    latencyMsP95: number;
  };
};
