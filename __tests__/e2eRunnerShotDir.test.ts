import { accessSync, constants, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runnerShotDir } from "../e2e/helpers/runnerShotDir";

const created: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function shotDir(name: string): string {
  const dir = runnerShotDir(name);
  created.push(dir);
  return dir;
}

describe("runnerShotDir", () => {
  it("creates a writable directory under the temp root named for the current user", () => {
    const name = `pubmax-runner-shot-dir-test-${process.pid}`;
    const dir = shotDir(name);

    expect(dir).toBe(join(tmpdir(), `${name}-${process.getuid?.() ?? process.pid}`));
    expect(statSync(dir).isDirectory()).toBe(true);
    accessSync(dir, constants.W_OK);
    writeFileSync(join(dir, "shot.png"), "");
    expect(runnerShotDir(name)).toBe(dir);
  });

  it("gives two users of the same machine different directories", () => {
    const name = `pubmax-runner-shot-dir-test-${process.pid}`;
    vi.spyOn(process, "getuid").mockReturnValue(501);
    const consoleUser = shotDir(name);
    vi.spyOn(process, "getuid").mockReturnValue(502);
    const runner = shotDir(name);

    expect(runner).not.toBe(consoleUser);
  });
});
