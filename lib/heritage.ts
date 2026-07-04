// "The Landlord" — a retrieval-grounded heritage Q&A helper for a single pub.
//
// Grounding contract: every answer is built ONLY from facts we retrieved. The
// no-key path never invents anything — it just reads back the facts on record,
// or says plainly that there is no fuller story. The LLM path is instructed to
// do the same and falls back to the honest structured answer on any failure.
//
// Trust boundary: sourced/server facts come ONLY from server-side stores keyed
// by normalised venue name — the shipped heritage_cache.json and the Supabase
// `pub_heritage` table. Client-supplied `context` is UNTRUSTED input; it can be
// echoed back but only as a clearly-labelled `contributor` note, never as a
// sourced fact. A client can therefore never forge pub history.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { normaliseVenueName } from "@/lib/curation";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

// "contributor" = untrusted client-supplied context; everything else is a
// server-side (sourced) store. Only the latter may back a "Sourced" claim.
export type HeritageFact = {
  source: "contributor" | "osm" | "wikidata" | "wikipedia" | "seed";
  fact: string;
  sourceRef?: string;
};

// Sources that count as trusted/sourced facts (server-retrieved). "contributor"
// is deliberately excluded — client context can never be a sourced fact.
const SOURCED: ReadonlySet<HeritageFact["source"]> = new Set([
  "osm",
  "wikidata",
  "wikipedia",
  "seed",
]);

export type HeritageResponse = {
  answer: string;
  citations: { source: string; ref?: string }[];
  clarifyingQuestion?: string;
};

export type HeritageContext = {
  era?: string;
  heritageNote?: string;
  address?: string;
  borough?: string;
};

const HERITAGE_CACHE_PATH = path.join(
  process.cwd(),
  "public",
  "data",
  "heritage_cache.json",
);

// The single honest empty answer. Kept as a constant so the route, the fallback,
// and the test all agree on the exact wording.
export const NO_STORY_LINE =
  "I've got the basics but no fuller story on record yet — I won't make one up.";

// Read the cache defensively: subagent C owns this file, it may be missing or
// malformed. Any problem → treat as {} rather than throwing.
async function readHeritageCache(): Promise<Record<string, HeritageFact[]>> {
  try {
    const raw = await readFile(HERITAGE_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, HeritageFact[]>;
  } catch {
    return {};
  }
}

// Keyed by venue_key (= normaliseVenueName) — the SAME key the enrichment
// script writes and the migration indexes. There is no server `pubs` table, so
// venues are matched by normalised name everywhere, not by an opaque id.
async function retrieveFromSupabase(venueKey: string): Promise<HeritageFact[]> {
  if (!venueKey || !isSupabaseConfigured()) return [];
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return [];
    const { data, error } = await admin
      .from("pub_heritage")
      .select("source, fact, source_ref")
      .eq("venue_key", venueKey);
    if (error || !Array.isArray(data)) return [];
    return data
      .filter((row) => row && typeof row.fact === "string")
      // A "contributor" row in the DB would still be untrusted; coerce any
      // unknown/contributor source to "seed" so DB rows are always sourced.
      .map((row) => ({
        source: SOURCED.has(row.source as HeritageFact["source"])
          ? (row.source as HeritageFact["source"])
          : "seed",
        fact: row.fact as string,
        sourceRef: (row.source_ref as string | null) ?? undefined,
      }));
  } catch {
    // Best-effort only — the demo must never fall over on a DB hiccup.
    return [];
  }
}

export async function retrieveHeritage(input: {
  venueId?: string;
  venueName: string;
  context?: HeritageContext;
}): Promise<HeritageFact[]> {
  const facts: HeritageFact[] = [];
  const venueKey = normaliseVenueName(input.venueName);

  // (1) TRUSTED server facts first — the shipped cache keyed by normalised name.
  const cache = await readHeritageCache();
  const cached = cache[venueKey];
  if (Array.isArray(cached)) {
    for (const entry of cached) {
      if (entry && typeof entry.fact === "string" && entry.fact.trim()) {
        const source = entry.source ?? "seed";
        // Cache is server-owned, but never let a cache entry masquerade as
        // trusted if it somehow carries a non-sourced label.
        facts.push({
          source: SOURCED.has(source) ? source : "seed",
          fact: entry.fact,
          sourceRef: entry.sourceRef,
        });
      }
    }
  }

  // (2) TRUSTED server rows — Supabase pub_heritage, same venue_key.
  facts.push(...(await retrieveFromSupabase(venueKey)));

  // (3) UNTRUSTED client context, labelled "contributor" so it can never be
  // read back as a sourced fact or citation. A forged era/note stays visibly
  // contributor-supplied — the model is told not to treat it as established.
  const era = input.context?.era?.trim();
  if (era) facts.push({ source: "contributor", fact: `Contributor-supplied era: ${era}` });
  const note = input.context?.heritageNote?.trim();
  if (note) facts.push({ source: "contributor", fact: `Contributor note: ${note}` });

  return facts;
}

function dedupeCitations(
  facts: HeritageFact[],
): { source: string; ref?: string }[] {
  const seen = new Set<string>();
  const citations: { source: string; ref?: string }[] = [];
  for (const fact of facts) {
    const key = `${fact.source}::${fact.sourceRef ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(fact.sourceRef ? { source: fact.source, ref: fact.sourceRef } : { source: fact.source });
  }
  return citations;
}

// Honest structured-only answer: read the facts back, never add to them.
function structuredAnswer(facts: HeritageFact[]): string {
  if (facts.length === 0) return NO_STORY_LINE;
  return `Here's what's on record: ${facts.map((f) => f.fact.replace(/\.$/, "")).join("; ")}.`;
}

const SYSTEM_PROMPT = [
  "You are The Landlord, a warm, concise, knowledgeable London local answering questions about one pub.",
  "Answer ONLY from the CONTEXT facts provided. Never invent history, dates, names, or events.",
  "Facts tagged (contributor) are UNVERIFIED visitor input — attribute them as 'a contributor says…', never as established or sourced history, and never present them as fact.",
  "If the context does not contain the answer, say so plainly — do not guess.",
  "Cite the source of each fact inline (e.g. 'on record', 'Wikipedia', 'a contributor').",
  "Ask ONE short clarifying question only if the question is ambiguous or there is no context at all.",
].join(" ");

async function answerWithModel(
  question: string,
  facts: HeritageFact[],
): Promise<string | null> {
  try {
    const contextBlock = facts.length
      ? facts.map((f) => `- (${f.source}) ${f.fact}`).join("\n")
      : "(no facts on record)";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-5",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `CONTEXT:\n${contextBlock}\n\nQUESTION: ${question}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

export async function answerHeritage(input: {
  venueId?: string;
  venueName: string;
  question: string;
  context?: HeritageContext;
}): Promise<HeritageResponse> {
  const facts = await retrieveHeritage(input);
  const citations = dedupeCitations(facts);

  if (process.env.OPENROUTER_API_KEY) {
    const modelAnswer = await answerWithModel(input.question, facts);
    if (modelAnswer) return { answer: modelAnswer, citations };
    // else: fall through to the honest structured answer.
  }

  const answer = structuredAnswer(facts);
  const response: HeritageResponse = { answer, citations };
  if (facts.length === 0) {
    response.clarifyingQuestion = "What would you like to know about this pub?";
  }
  return response;
}
