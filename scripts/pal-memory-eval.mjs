#!/usr/bin/env node
// The Pal memory eval only ever seeds the process-memory stores.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { runPalMemoryEval } = await import("../evals/pal/memory/runMemoryEval.ts");

try {
  const scoreboard = await runPalMemoryEval({ writeScoreboard: true });
  console.log(JSON.stringify(scoreboard.totals));
  for (const persona of scoreboard.personas.filter((p) => !p.pass)) {
    const failed = [...persona.typed.checks.map((c) => ({ ...c, surface: "typed" })), ...persona.voice.checks.map((c) => ({ ...c, surface: "voice" }))].filter((c) => !c.pass);
    for (const check of failed) console.error(`${persona.id} ${check.surface} ${check.name}: ${check.detail}`);
  }
  if (!scoreboard.totals.pass) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
