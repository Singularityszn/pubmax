#!/usr/bin/env node
// The Pal memory eval. Without flags it runs layer 1 (what reaches the model),
// offline. With --live it also runs layer 2 (what the model does with it)
// against the ElevenLabs agent named by ELEVENLABS_PUB_PAL_AGENT_ID, one
// typed turn per probe.
//
// Both layers only ever seed the process-memory stores.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const live = process.argv.includes("--live");

const { runPalMemoryEval, loadPalMemorySuite } = await import("../evals/pal/memory/runMemoryEval.ts");

function printFailures(scoreboard) {
  for (const persona of scoreboard.personas.filter((p) => !p.pass)) {
    const failed = [
      ...persona.typed.checks.map((c) => ({ ...c, surface: "typed" })),
      ...persona.voice.checks.map((c) => ({ ...c, surface: "voice" })),
    ].filter((c) => !c.pass);
    for (const check of failed) console.error(`${persona.id} ${check.surface} ${check.name}: ${check.detail}`);
  }
}

try {
  const retrieval = await runPalMemoryEval({ writeScoreboard: true });
  console.log(JSON.stringify({ layer: "retrieval", ...retrieval.totals }));
  printFailures(retrieval);
  if (!retrieval.totals.pass) process.exitCode = 1;

  if (live) {
    if (!process.env.ELEVENLABS_API_KEY?.trim() || !process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim()) {
      throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_PUB_PAL_AGENT_ID must be set for --live. Nothing was sent.");
    }
    const probes = loadPalMemorySuite().personas.reduce((total, persona) => total + persona.probes.length, 0);
    console.error(`Asking the live agent ${probes} probes, one typed turn each.`);
    const { livePalMemoryResponder, runPalMemoryUseEval } = await import("../evals/pal/memory/runMemoryUseEval.ts");
    const use = await runPalMemoryUseEval({
      responder: livePalMemoryResponder(),
      responderName: "elevenlabs",
      writeScoreboard: true,
    });
    console.log(JSON.stringify({ layer: "use", ...use.totals }));
    for (const probe of use.probes.filter((p) => p.falseMemories.length > 0 || !p.ok)) {
      console.error(`${probe.persona} "${probe.ask}": ${probe.ok ? `false memory: ${probe.falseMemories.join(" / ")}` : probe.reply}`);
    }
    if (!use.totals.pass) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
