// The Pal memory eval, retrieval layer.
//
// Seeds made-up people into the process-memory stores, then reads each one back
// through the production readers and formatters: what typed chat puts in the
// agent's user message (palPersonalContext) and what the voice recall webhook
// answers (recallPalMemoriesForConversation). It grades what reaches the model,
// not what the model does with it. That second layer needs the live agent and
// is described in README.md.
//
// It never touches a durable store: it refuses to run when Supabase is
// configured, because seeding is a write.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { __resetDiary, diaryStore } from "@/lib/diaryStore";
import { palPersonalContext } from "@/lib/palElevenLabsChat.server";
import {
  readConfirmedPalMemories,
  recallPalMemoriesForConversation,
} from "@/lib/palConfirmedMemories.server";
import { __resetPalTasteCache, readPalTaste } from "@/lib/palTaste.server";
import { __resetPintDrops } from "@/lib/pintDrops";
import type { VibeTag } from "@/lib/pintDropShared";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { __resetMemoryProfiles, profileStore } from "@/lib/profileStore";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { __resetPubPalStore, confirmPalMemoryResult, createPubPalResult } from "@/lib/pubPalStore";
import { __resetPubPalToolTurnStore, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import { parseRating } from "@/lib/ratings";
import { __resetMemorySavedPubs, savedPubsStore } from "@/lib/savedPubsStore";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getVenueIndex } from "@/lib/venueIndex";
import type {
  PalMemoryCheck,
  PalMemoryLine,
  PalMemoryPersona,
  PalMemoryPersonaResult,
  PalMemoryScoreboard,
  PalMemorySuite,
  PalMemorySurfaceResult,
} from "@/evals/pal/memory/types";

const SUITE_PATH = "evals/pal/memory/personas.json";
const SCOREBOARD_DIR = "evals/pal/memory/scoreboard";

/** Each key finds its line whether the context speaks as the person or about them. */
const LINE_PATTERNS: Record<PalMemoryLine, RegExp> = {
  patches: /usual patches:/,
  regulars: /keep going back to:/,
  loved: /rated highest:/,
  notKeen: /rated low/,
  drinks: /usually drink:/,
  price: /usually pay about/,
  vibes: /tag (?:my|their) pints with:/,
  wishlist: /Saved but not tried yet:/,
  lastVisit: /most recently/,
};

const TASTE_HEADER = /own logs say about/;

export function loadPalMemorySuite(root = process.cwd()): PalMemorySuite {
  return JSON.parse(readFileSync(join(root, SUITE_PATH), "utf8")) as PalMemorySuite;
}

function resetStores(): void {
  __resetDiary();
  __resetPintDrops();
  __resetMemorySavedPubs();
  __resetMemoryProfiles();
  __resetPubPalStore();
  __resetPubPalToolTurnStore();
  __resetPalTasteCache();
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedPersona(persona: PalMemoryPersona, now: number, nameOf: (id: string) => string): Promise<void> {
  await profileStore().createOwned(persona.handle, persona.userId);
  if (persona.pal) {
    const created = await createPubPalResult(persona.userId, {
      ...DEFAULT_PAL_DRAFT,
      adultConfirmed: true,
      name: "Eval",
      proposalPreferences: { memories: true, routes: true, taste: persona.pal.taste },
    });
    if (!created.ok) throw new Error(`Could not create a Pal for ${persona.id}.`);
  }
  for (const memory of persona.memories) {
    const confirmed = await confirmPalMemoryResult(persona.userId, memory);
    if (!confirmed.ok) throw new Error(`Could not confirm a memory for ${persona.id}: ${memory.value}`);
    // Recall orders by updatedAt, so each memory needs its own millisecond.
    await pause(2);
  }
  for (const entry of persona.diary) {
    const result = await diaryStore().create(
      {
        ownerUserId: persona.userId,
        venueId: entry.venueId,
        venueName: nameOf(entry.venueId),
        visitedOn: entry.visitedOn,
        rating: parseRating(entry.rating),
        review: "",
        visibility: "private",
      },
      now,
    );
    if (result.status !== "created") throw new Error(`Could not log ${entry.venueId} on ${entry.visitedOn} for ${persona.id}.`);
  }
  for (const drop of persona.drops) {
    await pintDropsStore().create(
      {
        id: randomUUID(),
        venueId: drop.venueId,
        handle: persona.handle,
        drink: drop.drink,
        ...(drop.measure ? { measure: drop.measure } : {}),
        priceGbp: drop.priceGbp,
        passedDownNote: "",
        era: "",
        vibeTags: drop.vibeTags as VibeTag[],
        provenance: "contributor",
        status: "visible",
        visibility: "public",
        createdAt: `${drop.day}T19:30:00.000Z`,
      },
      { pint: null, venue: null, receipt: null },
    );
  }
  for (const venueId of persona.saved) {
    await savedPubsStore(persona.handle).toggleSaved({ handle: persona.handle, venueId, listType: "Want to go" });
  }
}

function found(segments: readonly string[], value: string, line?: PalMemoryLine): boolean {
  return segments.some((segment) => (!line || LINE_PATTERNS[line].test(segment)) && segment.includes(value));
}

function gradeSurface(
  persona: PalMemoryPersona,
  segments: readonly string[],
  foreign: readonly string[],
  extraChecks: PalMemoryCheck[],
): PalMemorySurfaceResult {
  const must = persona.facts.filter((fact) => fact.tier === "must");
  const stretch = persona.facts.filter((fact) => fact.tier === "stretch");
  const missing = must.filter((fact) => !found(segments, fact.value, fact.line)).map((fact) => fact.id);
  const leaks = [
    ...persona.absent.filter((item) => found(segments, item.value, item.line)).map((item) => `${item.value} (${item.why})`),
    ...foreign.filter((value) => found(segments, value)).map((value) => `${value} (another person's)`),
  ];
  const checks: PalMemoryCheck[] = [
    { name: "must_recall", pass: missing.length === 0, detail: missing.length ? `missing ${missing.join(", ")}` : "every must fact reached the model" },
    { name: "no_leaks", pass: leaks.length === 0, detail: leaks.length ? leaks.join("; ") : "nothing reached the model that should not have" },
    ...extraChecks,
  ];
  if (persona.noTasteRead) {
    const tasteLine = segments.some((segment) => TASTE_HEADER.test(segment));
    checks.push({ name: "opt_out", pass: !tasteLine, detail: tasteLine ? "a taste read reached the model after opting out" : "no taste read after opting out" });
  }
  return {
    pass: checks.every((check) => check.pass),
    mustFound: must.length - missing.length,
    mustTotal: must.length,
    stretchFound: stretch.filter((fact) => found(segments, fact.value, fact.line)).length,
    stretchTotal: stretch.length,
    leaks,
    missing,
    checks,
    contextChars: segments.join("\n").length,
  };
}

/** Another person's values, minus any this persona legitimately shares. */
export function foreignValues(persona: PalMemoryPersona, suite: PalMemorySuite, nameOf: (id: string) => string): string[] {
  const own = new Set([
    ...persona.facts.map((fact) => fact.value),
    ...[...persona.diary.map((entry) => entry.venueId), ...persona.drops.map((drop) => drop.venueId), ...persona.saved].map(nameOf),
  ]);
  const values = new Set<string>();
  for (const other of suite.personas) {
    if (other.id === persona.id) continue;
    for (const fact of other.facts) if (!fact.generic) values.add(fact.value);
    for (const memory of other.memories) values.add(memory.value);
    for (const venueId of [...other.diary.map((entry) => entry.venueId), ...other.drops.map((drop) => drop.venueId), ...other.saved]) {
      values.add(nameOf(venueId));
    }
  }
  return [...values].filter((value) => value && ![...own].some((mine) => mine.includes(value) || value.includes(mine)));
}

export type SeededPalMemorySuite = { suite: PalMemorySuite; now: number; nameOf: (venueId: string) => string };

/**
 * Seeds every persona into fresh process-memory stores, runs `body`, then
 * clears them again. Both layers of the eval start here.
 */
export async function withSeededPalMemorySuite<T>(
  root: string,
  body: (seeded: SeededPalMemorySuite) => Promise<T>,
): Promise<T> {
  if (isSupabaseConfigured()) {
    throw new Error("The memory eval seeds made-up people and only runs on the process-memory stores. Unset SUPABASE_URL.");
  }
  const suite = loadPalMemorySuite(root);
  const now = Date.parse(suite.now);
  const index = await getVenueIndex();
  const nameOf = (venueId: string): string => {
    const name = index.get(venueId)?.name;
    if (!name) throw new Error(`The memory eval names ${venueId}, which the venue index does not hold.`);
    return name;
  };
  resetStores();
  try {
    for (const persona of suite.personas) await seedPersona(persona, now, nameOf);
    return await body({ suite, now, nameOf });
  } finally {
    resetStores();
  }
}

/**
 * The personal context typed chat sends for this persona, through the
 * production readers. Recall ranks memories against the ask, so a probe is
 * judged against the context built for its own words. No ask is a turn with
 * nothing to rank by.
 */
export async function personaContext(persona: PalMemoryPersona, now: number, ask = ""): Promise<string[]> {
  const [memories, taste] = await Promise.all([readConfirmedPalMemories(persona.userId, ask), readPalTaste(persona.userId, now)]);
  return palPersonalContext(memories, taste);
}

/** Whether a fact reached the context, in its line when it names one. */
export function factInContext(context: readonly string[], fact: { value: string; line?: PalMemoryLine }): boolean {
  return found(context, fact.value, fact.line);
}

type RunPalMemoryEvalOptions = { root?: string; writeScoreboard?: boolean };

export async function runPalMemoryEval(options: RunPalMemoryEvalOptions = {}): Promise<PalMemoryScoreboard> {
  const root = options.root ?? process.cwd();
  return withSeededPalMemorySuite(root, async ({ suite, now, nameOf }) => {
    const results: PalMemoryPersonaResult[] = [];
    for (const [position, persona] of suite.personas.entries()) {
      const context = await personaContext(persona, now);

      const conversationId = `conv_evalmemory${String(position).padStart(4, "0")}`;
      await registerPubPalToolTurn(conversationId, {
        query: "eval",
        cityId: "london",
        ownerId: persona.userId,
        turns: [],
        summary: "",
      });
      const recall = await recallPalMemoriesForConversation(conversationId);
      // The voice answer is one string; its taste lines each start "- ".
      const voiceSegments = recall.result.answerHint.split(/ (?=- )/);

      const foreign = foreignValues(persona, suite, nameOf);
      const exactChecks: PalMemoryCheck[] = persona.exactContext
        ? [
            {
              name: "exact_context",
              pass: JSON.stringify(context) === JSON.stringify(persona.exactContext),
              detail: JSON.stringify(context),
            },
          ]
        : [];
      const typed = gradeSurface(persona, context, foreign, exactChecks);
      const voice = gradeSurface(persona, voiceSegments, foreign, [
        { name: "recall_ok", pass: recall.result.ok, detail: recall.result.answerHint.slice(0, 120) },
      ]);
      const factById = new Map(persona.facts.map((fact) => [fact.id, fact]));
      const probes: PalMemoryPersonaResult["probes"] = [];
      for (const probe of persona.probes) {
        const probeContext = await personaContext(persona, now, probe.ask);
        const missing = probe.needs.filter((id) => {
          const fact = factById.get(id);
          if (!fact) throw new Error(`Probe "${probe.ask}" in ${persona.id} needs unknown fact ${id}.`);
          return !found(probeContext, fact.value, fact.line);
        });
        probes.push({ ask: probe.ask, answerable: missing.length === 0, missing });
      }
      // Recall ranks by the ask, so every probe's facts must reach the model.
      const probesAnswered = probes.every((probe) => probe.answerable);
      results.push({ id: persona.id, pass: typed.pass && voice.pass && probesAnswered, typed, voice, probes, context });
    }

    const surfaces = results.flatMap((result) => [result.typed, result.voice]);
    const sum = (pick: (surface: PalMemorySurfaceResult) => number) => surfaces.reduce((total, surface) => total + pick(surface), 0);
    const ratio = (part: number, whole: number) => (whole === 0 ? 1 : Math.round((part / whole) * 1000) / 1000);
    const probes = results.flatMap((result) => result.probes);
    const scoreboard: PalMemoryScoreboard = {
      now: suite.now,
      personas: results,
      totals: {
        pass: results.every((result) => result.pass),
        personas: results.length,
        mustRecall: ratio(sum((s) => s.mustFound), sum((s) => s.mustTotal)),
        stretchRecall: ratio(sum((s) => s.stretchFound), sum((s) => s.stretchTotal)),
        leaks: sum((s) => s.leaks.length),
        probesAnswerable: probes.filter((probe) => probe.answerable).length,
        probes: probes.length,
        avgContextChars: Math.round(results.reduce((total, result) => total + result.typed.contextChars, 0) / Math.max(1, results.length)),
      },
    };
    if (options.writeScoreboard) writeScoreboard(root, scoreboard);
    return scoreboard;
  });
}

function writeScoreboard(root: string, scoreboard: PalMemoryScoreboard): void {
  const dir = join(root, SCOREBOARD_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(scoreboard, null, 2)}\n`);
  const { totals } = scoreboard;
  const lines = [
    "# Pal memory eval",
    "",
    `Pinned at ${scoreboard.now}. ${totals.pass ? "Passing" : "FAILING"}.`,
    "",
    `- Must recall: ${totals.mustRecall}`,
    `- Stretch recall: ${totals.stretchRecall}`,
    `- Leaks: ${totals.leaks}`,
    `- Probes answerable from memory: ${totals.probesAnswerable} of ${totals.probes}`,
    `- Average typed context: ${totals.avgContextChars} characters`,
    "",
    "| Persona | Pass | Typed must | Voice must | Stretch | Leaks | Probes |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ...scoreboard.personas.map(
      (p) =>
        `| ${p.id} | ${p.pass ? "yes" : "no"} | ${p.typed.mustFound}/${p.typed.mustTotal} | ${p.voice.mustFound}/${p.voice.mustTotal} | ${p.typed.stretchFound}/${p.typed.stretchTotal} | ${p.typed.leaks.length + p.voice.leaks.length} | ${p.probes.filter((probe) => probe.answerable).length}/${p.probes.length} |`,
    ),
    "",
  ];
  writeFileSync(join(dir, "latest.md"), lines.join("\n"));
}
