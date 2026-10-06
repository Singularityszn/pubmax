#!/usr/bin/env node
// One command for a production release: deploy, promote, then dispatch the
// production smoke suite on the released commit and wait for it.
// The ordered steps and their refusals live in scripts/lib/releaseProduction.mjs.
// docs/DEPLOYMENT.md "One release command" owns the runbook.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { vercelCommand } from "./lib/vercelCli.mjs";
import { checkMigrationLedger } from "./lib/migrationLedger.mjs";
import { releaseProduction, ReleaseRefusal } from "./lib/releaseProduction.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(command, args, { capture = false } = {}) {
  const resolved = command === "vercel" ? vercelCommand(args) : { command, args };
  return new Promise((resolve) => {
    const child = spawn(resolved.command, resolved.args, {
      cwd: projectRoot,
      stdio: ["inherit", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      // A captured step still prints, so the operator watches the build.
      if (!capture || command === "node") process.stdout.write(chunk);
    });
    child.on("error", (error) => {
      console.error(`Could not run ${resolved.command}: ${error.message}`);
      resolve({ status: 127, stdout });
    });
    child.on("close", (status) => resolve({ status: status ?? 1, stdout }));
  });
}

async function deploymentIdAt(origin) {
  try {
    const response = await fetch(`${origin}/api/version`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.deploymentId === "string" && body.deploymentId ? body.deploymentId : null;
  } catch {
    return null;
  }
}

try {
  await releaseProduction({
    run,
    deploymentIdAt,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    say: (line) => console.log(`[release] ${line}`),
    // Read-only. Production must already hold every migration this commit ships.
    preflight: [
      {
        name: "production holds every migration in the repo",
        run: async () => {
          try {
            await checkMigrationLedger({ say: (line) => console.log(`[ledger] ${line}`) });
          } catch (error) {
            throw new ReleaseRefusal(error instanceof Error ? error.message : String(error));
          }
        },
      },
    ],
  });
} catch (error) {
  if (error instanceof ReleaseRefusal) {
    console.error(`[release] ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
