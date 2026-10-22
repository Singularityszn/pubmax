import type { AskResponseBody } from "@/lib/ask/types";

import type { PalEvalAnswerExpectations } from "./types";
import type { PalEvalVenueIndex } from "./venueIndex";

export type GradeOutcome = {
  pass: boolean;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
  inventedVenues: number;
};

function push(
  checks: Array<{ name: string; pass: boolean; detail: string }>,
  name: string,
  pass: boolean,
  detail: string,
): void {
  checks.push({ name, pass, detail });
}

function hoursClaims(text: string): string[] {
  return text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b(?:0?[1-9]|1[0-2])(?:[.:][0-5]\d)?\s*[ap]\.?m\.?|\b(?:midnight|noon|24\s*hours?|open\s+(?:now|all day)|closed\s+now|(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+closed)\b/gi) ?? [];
}

function matchesKnownHours(text: string, lines: string[]): boolean {
  if (!lines.length || !lines.every((line) => text.includes(line))) return false;
  const withoutKnownLines = lines.reduce((remaining, line) => remaining.replaceAll(line, ""), text);
  return hoursClaims(withoutKnownLines).length === 0;
}

function gradeInventedVenues(
  body: AskResponseBody,
  index: PalEvalVenueIndex,
): { inventedVenues: number; details: string[] } {
  const details: string[] = [];
  let inventedVenues = 0;
  for (const card of body.cards) {
    if (!card.venueId) continue;
    if (!index.ids.has(card.venueId)) {
      inventedVenues += 1;
      details.push(`unknown venueId ${card.venueId} (${card.title})`);
    }
  }
  return { inventedVenues, details };
}

function gradeHeritage(
  body: AskResponseBody,
  reference: NonNullable<PalEvalAnswerExpectations["heritageAnswer"]>,
  checks: GradeOutcome["checks"],
): void {
  const normalise = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  const cards = body.cards.filter((card) => card.venueId === reference.venueId);
  push(checks, "heritage_venue", cards.length > 0 && body.cards.every((card) =>
    card.venueId === reference.venueId && normalise(card.title) === normalise(reference.venueName)),
  `expected=${reference.venueId}`);
  if (!reference.facts.length) {
    // A closed set is deliberate: arbitrary prose needs a wording judge.
    const allowed = new Set([
      "I've got the basics but no fuller story on record yet. I won't make one up.",
      `The history of ${reference.venueName} is not known.`,
      `The heritage of ${reference.venueName} is not known.`,
      `I cannot confirm the history of ${reference.venueName}.`,
    ].map(normalise));
    push(checks, "unknown_heritage_disclosed", allowed.has(normalise(body.answer)), body.answer);
    push(checks, "unknown_heritage_empty", body.cards.every((card) =>
      !card.note.trim() || allowed.has(normalise(card.note))), body.cards.map((card) => card.note).join("\n"));
    push(checks, "unknown_heritage_unsourced", body.sources.length === 0 && body.cards.every((card) =>
      !card.provenance || (card.provenance.kind === "heritage"
        && card.provenance.label === "Heritage" && !card.provenance.url)), "No recorded heritage source");
  } else {
    const facts = reference.facts;
    const factText = facts.map((fact) => fact.fact).join(" ");
    const summary = `On record for ${reference.venueName}: ${facts.length} fact${facts.length === 1 ? "" : "s"}.`;
    push(checks, "known_heritage_value", cards.some((card) => normalise(card.note) === normalise(factText))
      && body.cards.every((card) => normalise(card.note) === normalise(factText))
      && [summary, factText].map(normalise).includes(normalise(body.answer)), `expected=${factText}`);
    const matchesSource = (source: NonNullable<typeof body.cards[number]["provenance"]>, fact: typeof facts[number]) =>
      source.kind === "heritage" && source.label === fact.source && source.url === fact.sourceUrl;
    push(checks, "known_heritage_source", cards.some((card) => card.provenance
      && facts.some((fact) => card.note.includes(fact.fact) && matchesSource(card.provenance!, fact)))
      && facts.every((fact) => body.sources.some((source) => matchesSource(source, fact)))
      && body.sources.every((source) => facts.some((fact) => matchesSource(source, fact))),
    `expected=${facts.map((fact) => fact.source).join(",")}`);
  }
}

function gradeHours(
  body: AskResponseBody,
  reference: NonNullable<PalEvalAnswerExpectations["hoursAnswer"]>,
  checks: GradeOutcome["checks"],
): void {
  const text = [body.answer, ...body.cards.map((card) => card.note)].join("\n");
  if (reference.venueId) {
    push(checks, "hours_venue", body.cards.some((card) => card.venueId === reference.venueId),
      `expected=${reference.venueId}`);
  }
  if (reference.value === null) {
    const times = hoursClaims(text);
    push(checks, "unknown_hours_empty", times.length === 0, `claims=${times.join(",")}`);
    const hours = String.raw`(?:opening hours?|opening times?|closing times?|hours)`;
    const absent = String.raw`(?:not known|unknown|not recorded|not available|unavailable)`;
    const disclosure = new RegExp(
      String.raw`\b${hours}\b[^.!?\n]{0,80}\b${absent}\b|\bno\s+${hours}\b|\b(?:cannot|can't|do not|don't)\s+(?:confirm|verify|provide|know)\b[^.!?\n]{0,80}\b${hours}\b`,
      "i",
    );
    push(checks, "unknown_hours_disclosed", disclosure.test(body.answer), body.answer);
  } else {
    const lines = reference.value;
    const cards = body.cards.filter((card) => card.venueId === reference.venueId);
    push(checks, "known_hours_value", matchesKnownHours(body.answer, lines) && matchesKnownHours(text, lines),
      `expected=${lines.join(", ")}`);
    push(checks, "known_hours_source", cards.some((card) => matchesKnownHours(card.note, lines)
      && card.provenance?.kind === "directory" && card.provenance.label === reference.source
      && (reference.sourceUrl === undefined || card.provenance.url === reference.sourceUrl)),
    `expected=${reference.source}`);
  }
}

export function gradePalCase(
  body: AskResponseBody,
  expect: PalEvalAnswerExpectations,
  index: PalEvalVenueIndex,
): GradeOutcome {
  const checks: Array<{ name: string; pass: boolean; detail: string }> = [];
  const { inventedVenues, details } = gradeInventedVenues(body, index);
  push(
    checks,
    "invented_venues",
    inventedVenues === 0,
    inventedVenues === 0 ? "none" : details.join("; "),
  );

  if (expect.expectedTools?.length) {
    const used = body.toolsUsed;
    const ok = expect.expectedTools.every((tool) => used.includes(tool));
    push(checks, "tool_routing", ok, `used=${used.join(",")} expected=${expect.expectedTools.join(",")}`);
  }

  if (expect.anyTools?.length) {
    const ok = expect.anyTools.some((tool) => body.toolsUsed.includes(tool));
    push(checks, "tool_any", ok, `used=${body.toolsUsed.join(",")}`);
  }

  if (expect.expectEmpty) {
    push(checks, "empty_answer", body.cards.length === 0, `cards=${body.cards.length}`);
  }

  if (expect.minCards !== undefined) {
    push(checks, "min_cards", body.cards.length >= expect.minCards, `cards=${body.cards.length}`);
  }

  if (expect.expectDegraded) {
    push(checks, "degraded", body.status === "degraded", `status=${body.status}`);
  }

  for (const fragment of expect.answerIncludes ?? []) {
    push(
      checks,
      `answer_includes:${fragment}`,
      body.answer.toLowerCase().includes(fragment.toLowerCase()),
      body.answer.slice(0, 120),
    );
  }

  if (expect.heritageAnswer) gradeHeritage(body, expect.heritageAnswer, checks);

  if (expect.hoursAnswer) gradeHours(body, expect.hoursAnswer, checks);

  if (expect.priceAnswer) {
    const reference = expect.priceAnswer;
    const cards = body.cards.filter((card) => card.venueId === reference.venueId);
    // This check covers single-venue price questions, not budgets or comparisons.
    const text = [body.answer, ...body.cards.flatMap((card) => [card.title, card.note])].join("\n");
    const amounts = [...text.matchAll(/(?:£\s*|\bGBP\s*)(\d+(?:\.\d+)?)|\b(\d+(?:\.\d+)?)\s*(?:pounds?|quid|GBP)\b|\b(\d+)\s*(?:pence|p)\b|\b(\d+\.\d{1,2})\b/gi)]
      .map((match) => match[3] ? Number(match[3]) / 100 : Number(match[1] ?? match[2] ?? match[4]));
    if (reference.value === null) {
      push(checks, "unknown_price_empty", body.cards.every((card) => card.price === null) && amounts.length === 0,
        `prices=${body.cards.map((card) => card.price).join(",")} amounts=${amounts.join(",")}`);
      push(checks, "unknown_price_disclosed",
        /\b(?:not known|unknown|not recorded|no listed figure|no (?:current )?recorded (?:pint|price)|(?:cannot|can't|do not|don't) (?:confirm|verify|provide|know))\b/i.test(body.answer),
        body.answer);
    } else {
      const value = reference.value;
      const tolerance = expect.priceTolerance ?? 0.02;
      push(checks, "known_price_value",
        cards.some((card) => card.price !== null && Math.abs(card.price - value) <= tolerance)
          && amounts.length > 0 && amounts.every((amount) => Math.abs(amount - value) <= tolerance),
        `expected=${value} amounts=${amounts.join(",")}`);
      push(checks, "known_price_source", cards.some((card) =>
        card.price !== null && Math.abs(card.price - value) <= tolerance
          && card.provenance?.kind === "directory"
          && (card.provenance.label === reference.source || card.provenance.label.startsWith(`${reference.source}.`))),
      `expected=${reference.source}`);
    }
  }

  const firstVenueCard = body.cards.find((c) => c.venueId);
  if (expect.topVenueId) {
    push(
      checks,
      "top_venue_id",
      firstVenueCard?.venueId === expect.topVenueId,
      `got=${firstVenueCard?.venueId ?? "none"}`,
    );
  }

  if (expect.topPrice !== undefined && firstVenueCard) {
    const tol = expect.priceTolerance ?? 0.02;
    const price = firstVenueCard.price;
    push(
      checks,
      "top_price",
      price !== null && Math.abs(price - expect.topPrice) <= tol,
      `got=${price} expected=${expect.topPrice}`,
    );
  }

  for (const card of body.cards) {
    if (!card.venueId || card.price === null || card.provenance?.kind !== "directory") continue;
    const recorded = index.priceById.get(card.venueId);
    const tol = expect.priceTolerance ?? 0.02;
    push(
      checks,
      `price_data:${card.venueId}`,
      recorded !== undefined && Math.abs(recorded - card.price) <= tol,
      `card=${card.price} index=${recorded ?? "unknown"}`,
    );
  }

  return { pass: checks.every((c) => c.pass), checks, inventedVenues };
}
