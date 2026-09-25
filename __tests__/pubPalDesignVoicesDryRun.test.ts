import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "pubpal", "design-pal-voices.mjs");

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop() as string, { recursive: true, force: true });
  }
});

function dryRun(env: Record<string, string>) {
  const cwd = mkdtempSync(path.join(tmpdir(), "pubmax-pubpal-voices-"));
  directories.push(cwd);
  return spawnSync(process.execPath, [SCRIPT, "--dry-run", "--species", "fox,robin"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ELEVENLABS_API_KEY: "",
      ELEVENLABS_VOICE_FOX: "",
      ELEVENLABS_VOICE_ROBIN: "",
      ...env,
    },
  });
}

describe("pubpal:design-voices dry run", () => {
  it("skips a species whose voice id is already set and designs the rest", () => {
    const result = dryRun({ ELEVENLABS_VOICE_FOX: "existing-fox-voice" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ELEVENLABS_VOICE_FOX is already set, skipping");
    expect(result.stdout).not.toContain("ELEVENLABS_VOICE_ROBIN is already set");
    expect(result.stdout).toContain("A warm British female voice");
  });
});
