import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});

import { factInContext, loadPalMemorySuite, personaContext } from "@/evals/pal/memory/runMemoryEval";
import { gradePalMemoryReply, livePalMemoryResponder, runPalMemoryUseEval } from "@/evals/pal/memory/runMemoryUseEval";
import type { PalMemoryPersona, PalMemoryResponder } from "@/evals/pal/memory/types";
import { defined } from "@/__tests__/helpers/defined";

const suite = loadPalMemorySuite();
const personaById = (id: string): PalMemoryPersona => defined(suite.personas.find((persona) => persona.id === id));
const probeOf = (persona: PalMemoryPersona, ask: string) => defined(persona.probes.find((probe) => probe.ask === ask));
const ok = (reply: string) => ({ ok: true, reply, latencyMs: 900, toolsUsed: [] });

/**
 * A Pal that only ever says what its context holds: it names each needed fact
 * that reached it, answers a quick pick and asks on a plan. Anything it misses
 * is retrieval's doing, never its own.
 */
const honestResponder: PalMemoryResponder = async ({ ownerId, ask }) => {
  const persona = defined(suite.personas.find((candidate) => candidate.userId === ownerId));
  const probe = probeOf(persona, ask);
  const context = await personaContext(persona, Date.parse(suite.now), ask);
  const known = probe.needs
    .map((id) => defined(persona.facts.find((fact) => fact.id === id)))
    .filter((fact) => factInContext(context, fact))
    .map((fact) => fact.value);
  const lead = known.length > 0 ? `Going off ${known.join(", ")}.` : "Right.";
  return ok(probe.mode === "ask" ? `${lead} Who is coming?` : `${lead} Try one near you.`);
};

describe("Pal memory eval, use layer", () => {
  it("passes a Pal that uses only what it was given, with nothing left for retrieval to miss", async () => {
    const scoreboard = await runPalMemoryUseEval({ responder: honestResponder, responderName: "honest" });

    expect(scoreboard.totals).toMatchObject({
      pass: true,
      falseMemories: 0,
      failedTurns: 0,
      blamedOnModel: 0,
      blamedOnRetrieval: 0,
      useRate: 1,
    });
    expect(scoreboard.totals.modePassed).toBe(scoreboard.totals.modeChecks);
  });

  it("lays a miss on retrieval when the fact never reached the model, and on the model when it did", () => {
    const longMemory = personaById("long-memory");
    const probe = probeOf(longMemory, "Fancy a glass of wine somewhere?");
    const reply = ok("Try a bar near you.");

    const neverSent = gradePalMemoryReply({ persona: longMemory, probe, reply, context: ["- Drinks: Drinks cask bitter"], foreign: [] });
    expect(neverSent).toMatchObject({ pass: false, answerable: false, blame: "retrieval" });

    const ignored = gradePalMemoryReply({
      persona: longMemory,
      probe,
      reply: ok("Try a natural wine bar near you."),
      context: ["- Drinks: Allergic to sulphites, so no wine"],
      foreign: [],
    });
    // "wine" is an alias, so the reply counts as using it; a reply that never
    // touches the fact is the model's miss.
    expect(ignored.used).toEqual(["long-03"]);
    const silent = gradePalMemoryReply({ persona: longMemory, probe, reply, context: ["- Drinks: Allergic to sulphites, so no wine"], foreign: [] });
    expect(silent).toMatchObject({ pass: false, answerable: true, blame: "model" });
  });

  it("calls a claim about a newcomer a false memory, and lets a plain question through", () => {
    const newcomer = personaById("newcomer");
    const context = ["I have not confirmed anything for you to remember about me."];
    const drinkProbe = probeOf(newcomer, "What do I usually drink?");

    const invented = gradePalMemoryReply({ persona: newcomer, probe: drinkProbe, reply: ok("You usually drink Guinness."), context, foreign: ["Guinness"] });
    expect(invented).toMatchObject({ pass: false, blame: "model", falseMemories: ["You usually drink Guinness."] });

    const honest = gradePalMemoryReply({
      persona: newcomer,
      probe: probeOf(newcomer, "Where should I go tonight?"),
      reply: ok("Where are you heading tonight?"),
      context,
      foreign: [],
    });
    expect(honest).toMatchObject({ pass: true, falseMemories: [], modeCheck: { mode: "ask", pass: true } });
  });

  it("flags a claim built on an opted-out log, but not the same pub offered as a pick", () => {
    const optedOut = personaById("opted-out");
    const probe = probeOf(optedOut, "Somewhere quiet tonight.");
    const context = ["Things I confirmed you should remember about me.", "- Atmosphere: Prefers a quiet table away from speakers"];

    const claim = gradePalMemoryReply({ persona: optedOut, probe, reply: ok("Your local is The Constitution, and it is quiet."), context, foreign: [] });
    expect(claim.falseMemories).toHaveLength(1);
    expect(claim.pass).toBe(false);

    const pick = gradePalMemoryReply({ persona: optedOut, probe, reply: ok("Try The Constitution for a quiet table."), context, foreign: [] });
    expect(pick).toMatchObject({ pass: true, falseMemories: [], used: ["optout-memory"] });
  });

  it("fails a quick pick met with only a question, and a plan met with four", () => {
    const soho = personaById("soho-regular");
    const context = ["- My usual patches: Piccadilly & Soho."];

    const dodged = gradePalMemoryReply({
      persona: soho,
      probe: probeOf(soho, "Somewhere for tonight, my usual sort of place."),
      reply: ok("Soho again? Which pub do you fancy?"),
      context,
      foreign: [],
    });
    expect(dodged).toMatchObject({ pass: false, blame: "model", modeCheck: { mode: "answer", pass: false } });

    const quizzed = gradePalMemoryReply({
      persona: soho,
      probe: probeOf(soho, "Plan my birthday crawl next Saturday."),
      reply: ok("Soho? How many? What time? What budget?"),
      context,
      foreign: [],
    });
    expect(quizzed.modeCheck).toMatchObject({ pass: false, detail: "4 questions" });
  });

  it("counts a turn that fails as a failure, never a skip", async () => {
    const scoreboard = await runPalMemoryUseEval({
      responder: async () => {
        throw new Error("provider down");
      },
      responderName: "broken",
    });
    expect(scoreboard.totals).toMatchObject({ pass: false, passed: 0, failedTurns: scoreboard.totals.probes });
    expect(scoreboard.probes[0]?.reply).toContain("provider down");
  });

  it("reads the live turn's failure as a failed reply, sending nothing without keys", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const reply = await livePalMemoryResponder()({ ownerId: personaById("soho-regular").userId, ask: "What do I usually drink?" });
    expect(reply).toMatchObject({ ok: false, reply: "(turn failed: UNAVAILABLE)", toolsUsed: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
