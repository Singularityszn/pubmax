// "The Landlord" — a retrieval-grounded heritage Q&A helper for a single pub.
//
// Grounding contract: every answer is built ONLY from facts we retrieved. The
// no-key path never invents anything — it just reads back the facts on record,
// or says plainly that there is no fuller story. The LLM path is instructed to
// do the same and falls back to the honest structured answer on any failure.
//
// Trust boundary: ALL venue context is reconstructed server-side. Facts come
// ONLY from server-owned stores keyed by normalised venue name — the shipped
// heritage_cache.json and the Supabase `pub_heritage` table. The route no
// longer accepts a client `context` object at all, so a client cannot forge
// pub history — not even as a labelled contributor note. If server facts are
// missing, the honest fallback stands.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { normaliseVenueName } from "@/lib/curation";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

// Every source is a server-side (sourced) store. There is no client-supplied
// source anymore — the route reconstructs context from server data only.
export type HeritageFact = {
  source: "osm" | "wikidata" | "wikipedia" | "seed";
  fact: string;
  sourceRef?: string;
};

// Sources that count as trusted/sourced facts (server-retrieved). Every source
// now qualifies; the set stays as the one place that names them.
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
}): Promise<HeritageFact[]> {
  const facts: HeritageFact[] = [];
  const venueKey = normaliseVenueName(input.venueName);

  // (1) Server facts first — the shipped cache keyed by normalised name.
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

  // (2) Server rows — Supabase pub_heritage, same venue_key.
  facts.push(...(await retrieveFromSupabase(venueKey)));

  // No client context is accepted — the route derives everything from the two
  // server-owned stores above.
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
  "Each CONTEXT fact is numbered like [F1]. When you use a fact, cite its id inline (e.g. [F1]). Never cite an id that does not appear in the CONTEXT.",
  "If the context does not contain the answer, say so plainly — do not guess.",
  "Also name the source of each fact inline (e.g. 'on record', 'Wikipedia').",
  "Ask ONE short clarifying question only if the question is ambiguous or there is no context at all.",
].join(" ");

// LLM bounds (PRD P3.10): deterministic, capped, and time-boxed. Any failure
// mode — timeout, network, bad status, phantom citation — returns null and the
// caller falls back to the honest structured answer.
const LLM_TIMEOUT_MS = 10_000;
const LLM_MAX_TOKENS = 400; // answers are a short paragraph; caps cost + runaway output

// Facts are numbered [F1]..[Fn] in the prompt. An answer citing an id outside
// the retrieved set is fabrication → reject the whole answer (null). Valid
// markers are stripped before the answer reaches the client.
const FACT_ID_RE = /\[F(\d+)\]/g;

function sanitiseModelAnswer(answer: string, factCount: number): string | null {
  for (const match of answer.matchAll(FACT_ID_RE)) {
    const id = Number(match[1]);
    if (id < 1 || id > factCount) return null;
  }
  const cleaned = answer
    .replace(FACT_ID_RE, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
  return cleaned || null;
}

async function answerWithModel(
  question: string,
  facts: HeritageFact[],
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const contextBlock = facts.length
      ? facts.map((f, i) => `- [F${i + 1}] (${f.source}) ${f.fact}`).join("\n")
      : "(no facts on record)";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-5",
        temperature: 0,
        max_tokens: LLM_MAX_TOKENS,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `CONTEXT:\n${contextBlock}\n\nQUESTION: ${question}` },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) return null;
    return sanitiseModelAnswer(text.trim(), facts.length);
  } catch {
    // Timeout/abort/network — never surface; the honest fallback takes over.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// P2 — 5-minute in-memory cache for LLM answers. Keyed by normalised venue key
// + a hash of the question, so it can never leak an answer across venues. Only
// the paid LLM path is cached (the deterministic fallback is already cheap), and
// hidden/moderated content never flows through here — facts come from the
// server stores, and a bounded TTL means a moderation change is reflected within
// five minutes. ponytail: process-memory Map, unbounded-in-theory but keyed on
// (venue, question) with a 5-min TTL so it self-prunes on read — move to an LRU
// only if key cardinality ever becomes a memory concern.
const ANSWER_CACHE_TTL_MS = 5 * 60_000;
const answerCache = new Map<string, { at: number; response: HeritageResponse }>();

function cacheKey(venueName: string, question: string): string {
  const qHash = createHash("sha256").update(question).digest("hex");
  return `${normaliseVenueName(venueName)}::${qHash}`;
}

export async function answerHeritage(input: {
  venueId?: string;
  venueName: string;
  question: string;
}): Promise<HeritageResponse> {
  const useLlm = Boolean(process.env.OPENROUTER_API_KEY);
  const key = useLlm ? cacheKey(input.venueName, input.question) : null;

  if (key) {
    const hit = answerCache.get(key);
    if (hit && Date.now() - hit.at < ANSWER_CACHE_TTL_MS) return hit.response;
    if (hit) answerCache.delete(key); // expired — prune on read
  }

  const facts = await retrieveHeritage(input);
  const citations = dedupeCitations(facts);

  if (useLlm) {
    const modelAnswer = await answerWithModel(input.question, facts);
    if (modelAnswer) {
      const response: HeritageResponse = { answer: modelAnswer, citations };
      answerCache.set(key!, { at: Date.now(), response });
      return response;
    }
    // else: fall through to the honest structured answer (not cached — cheap).
  }

  const answer = structuredAnswer(facts);
  const response: HeritageResponse = { answer, citations };
  if (facts.length === 0) {
    response.clarifyingQuestion = "What would you like to know about this pub?";
  }
  return response;
}

// Test-only: clear the answer cache between cases.
export function __resetHeritageCache(): void {
  answerCache.clear();
}
