// The Pal memory eval, use layer.
//
// Layer 1 (runMemoryEval.ts) grades what reaches the model. This layer asks
// each persona's probes through a responder and grades the reply: did it use
// the facts it was given, did it claim anything about the person it had no
// business claiming, and did it answer or ask the way the prompt says. The
// live responder is the production typed chat turn, against the captain's
// ElevenLabs agent. Tests drive it with scripted responders.
//
// Every probe is a fresh conversation, so all a reply can know about the
// person is what the server sends from their stores: memory across sessions,
// not within one.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import {
  factInContext,
  foreignValues,
  personaContext,
  withSeededPalMemorySuite,
} from "@/evals/pal/memory/runMemoryEval";
import type {
  PalMemoryPersona,
  PalMemoryProbeUse,
  PalMemoryReply,
  PalMemoryResponder,
  PalMemoryUseScoreboard,
} from "@/evals/pal/memory/types";

const SCOREBOARD_DIR = "evals/pal/memory/scoreboard";

/**
 * A sentence that tells the person something about themselves. Only these can
 * be a false memory: a pub name in a tool-sourced pick is not a claim about
 * the person, but "your usual is Guinness" is.
 */
const CLAIM_CUE =
  /\b(?:you(?:'ve| have)?\s+(?:usually|always|often|tend to|like|love|loved|rated|saved|logged|go|went|drink|prefer|said)|your\s+(?:usual|regular|local|favourite|go-to|patch|pint)|last time you|you're a (?:regular|fan)|I remember|I know you)\b/i;

function mentions(text: string, value: string): boolean {
  return value.length > 0 && text.toLocaleLowerCase("en-GB").includes(value.toLocaleLowerCase("en-GB"));
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function modeCheck(mode: "answer" | "ask", reply: string): { mode: "answer" | "ask"; pass: boolean; detail: string } {
  const all = sentences(reply);
  const questions = (reply.match(/\?/g) ?? []).length;
  if (mode === "answer") {
    const answered = all.some((sentence) => !sentence.endsWith("?"));
    return { mode, pass: answered, detail: answered ? "answered" : "only asked questions on a quick pick" };
  }
  const pass = questions >= 1 && questions <= 3;
  return { mode, pass, detail: `${questions} question${questions === 1 ? "" : "s"}` };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

/**
 * Grades one reply. Exported so the grader is tested on its own, apart from
 * any responder.
 */
export function gradePalMemoryReply(input: {
  persona: PalMemoryPersona;
  probe: PalMemoryPersona["probes"][number];
  reply: PalMemoryReply;
  context: readonly string[];
  foreign: readonly string[];
}): PalMemoryProbeUse {
  const { persona, probe, reply, context, foreign } = input;
  const factById = new Map(persona.facts.map((fact) => [fact.id, fact]));
  const needed = probe.needs.map((id) => {
    const fact = factById.get(id);
    if (!fact) throw new Error(`Probe "${probe.ask}" in ${persona.id} needs unknown fact ${id}.`);
    return fact;
  });
  const said = (fact: (typeof needed)[number]) => [fact.value, ...(fact.aliases ?? [])].some((value) => mentions(reply.reply, value));
  const used = needed.filter(said).map((fact) => fact.id);
  const unused = needed.filter((fact) => !said(fact)).map((fact) => fact.id);
  const minUsed = probe.minUsed ?? (needed.length > 0 ? 1 : 0);

  // A claim about the person is false when it cites another person's data, a
  // value this person's context must never carry, or anything at all when the
  // Pal has nothing on record for them.
  const knowsNothing = context.length <= 1;
  const forbidden = [...foreign, ...persona.absent.filter((item) => !item.line).map((item) => item.value)];
  const falseMemories = sentences(reply.reply)
    .filter((sentence) => CLAIM_CUE.test(sentence))
    .filter((sentence) => knowsNothing || forbidden.some((value) => mentions(sentence, value)));

  const mode = probe.mode ? modeCheck(probe.mode, reply.reply) : null;
  const answerable = needed.every((fact) => factInContext(context, fact));
  const usedEnough = used.length >= minUsed;
  const pass = reply.ok && usedEnough && falseMemories.length === 0 && (mode?.pass ?? true);
  const blame = pass ? "none" : !usedEnough && !answerable && reply.ok && falseMemories.length === 0 && (mode?.pass ?? true) ? "retrieval" : "model";

  return {
    persona: persona.id,
    ask: probe.ask,
    reply: reply.reply,
    ok: reply.ok,
    pass,
    used,
    unused,
    falseMemories,
    modeCheck: mode,
    answerable,
    blame,
    latencyMs: reply.latencyMs,
    toolsUsed: reply.toolsUsed,
  };
}

/** The production typed chat turn, one fresh conversation per probe. */
export function livePalMemoryResponder(): PalMemoryResponder {
  return async ({ ownerId, ask }) => {
    const started = performance.now();
    const outcome = await runPalElevenLabsChatTurn({ query: ask, ownerId, cityId: "london" });
    return {
      ok: outcome.ok,
      reply: outcome.ok ? outcome.message : `(turn failed: ${outcome.code})`,
      latencyMs: Math.round(performance.now() - started),
      toolsUsed: outcome.ok ? outcome.toolsUsed : [],
    };
  };
}

type RunPalMemoryUseEvalOptions = {
  responder: PalMemoryResponder;
  /** A short label for the scoreboard, such as "elevenlabs". */
  responderName: string;
  root?: string;
  writeScoreboard?: boolean;
};

export async function runPalMemoryUseEval(options: RunPalMemoryUseEvalOptions): Promise<PalMemoryUseScoreboard> {
  const root = options.root ?? process.cwd();
  return withSeededPalMemorySuite(root, async ({ suite, now, nameOf }) => {
    const probes: PalMemoryProbeUse[] = [];
    for (const persona of suite.personas) {
      const context = await personaContext(persona, now);
      const foreign = foreignValues(persona, suite, nameOf);
      for (const probe of persona.probes) {
        let reply: PalMemoryReply;
        try {
          reply = await options.responder({ ownerId: persona.userId, ask: probe.ask });
        } catch (error) {
          reply = { ok: false, reply: `(responder threw: ${error instanceof Error ? error.message : String(error)})`, latencyMs: 0, toolsUsed: [] };
        }
        probes.push(gradePalMemoryReply({ persona, probe, reply, context, foreign }));
      }
    }

    const needed = probes.reduce((total, probe) => total + probe.used.length + probe.unused.length, 0);
    const usedTotal = probes.reduce((total, probe) => total + probe.used.length, 0);
    const latencies = probes.filter((probe) => probe.ok).map((probe) => probe.latencyMs);
    const modes = probes.filter((probe) => probe.modeCheck);
    const totals: PalMemoryUseScoreboard["totals"] = {
      pass: false,
      probes: probes.length,
      passed: probes.filter((probe) => probe.pass).length,
      useRate: needed === 0 ? 1 : Math.round((usedTotal / needed) * 1000) / 1000,
      falseMemories: probes.reduce((total, probe) => total + probe.falseMemories.length, 0),
      modeChecks: modes.length,
      modePassed: modes.filter((probe) => probe.modeCheck?.pass).length,
      failedTurns: probes.filter((probe) => !probe.ok).length,
      blamedOnModel: probes.filter((probe) => probe.blame === "model").length,
      blamedOnRetrieval: probes.filter((probe) => probe.blame === "retrieval").length,
      latencyMsP50: percentile(latencies, 50),
      latencyMsP95: percentile(latencies, 95),
    };
    // The hard lines: the Pal never invents a memory, and every turn answers.
    // Use and mode are tracked scores, not gates.
    totals.pass = totals.falseMemories === 0 && totals.failedTurns === 0;

    const scoreboard: PalMemoryUseScoreboard = { now: suite.now, responder: options.responderName, probes, totals };
    if (options.writeScoreboard) writeUseScoreboard(root, scoreboard);
    return scoreboard;
  });
}

function writeUseScoreboard(root: string, scoreboard: PalMemoryUseScoreboard): void {
  const dir = join(root, SCOREBOARD_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "use-latest.json"), `${JSON.stringify(scoreboard, null, 2)}\n`);
  const { totals } = scoreboard;
  const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 160);
  const lines = [
    `# Pal memory eval: use (${scoreboard.responder})`,
    "",
    `Pinned at ${scoreboard.now}. ${totals.pass ? "No false memories, every turn answered." : "FAILING: a false memory or a failed turn."}`,
    "",
    `- Probes passed: ${totals.passed} of ${totals.probes}`,
    `- Use rate: ${totals.useRate}`,
    `- False memories: ${totals.falseMemories}`,
    `- Answer or ask as the prompt says: ${totals.modePassed} of ${totals.modeChecks}`,
    `- Failed turns: ${totals.failedTurns}`,
    `- Misses on the model: ${totals.blamedOnModel}. Misses on retrieval: ${totals.blamedOnRetrieval}`,
    `- Latency: p50 ${totals.latencyMsP50} ms, p95 ${totals.latencyMsP95} ms`,
    "",
    "| Persona | Ask | Pass | Used | Missed | Blame | ms | Reply |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ...scoreboard.probes.map(
      (p) =>
        `| ${p.persona} | ${cell(p.ask)} | ${p.pass ? "yes" : "no"} | ${p.used.join(", ")} | ${p.unused.join(", ")} | ${p.blame} | ${p.latencyMs} | ${cell(p.reply)} |`,
    ),
    "",
  ];
  writeFileSync(join(dir, "use-latest.md"), lines.join("\n"));
}
