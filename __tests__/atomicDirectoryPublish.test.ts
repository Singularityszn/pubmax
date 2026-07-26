import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { publishStagedDirectory } from "../scripts/lib/atomicDirectoryPublish.mjs";

const roots: string[] = [];

async function fixture(): Promise<{ target: string; staged: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "uk-base-publish-"));
  roots.push(root);
  const target = path.join(root, "uk_base");
  const staged = path.join(root, ".uk_base-stage");
  await fs.mkdir(target);
  await fs.mkdir(staged);
  await fs.writeFile(path.join(target, "README.md"), "hand written");
  await fs.writeFile(path.join(target, "manifest.json"), "old manifest");
  return { target, staged };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("publishStagedDirectory", () => {
  it("publishes a complete staged pack while preserving the handwritten README", async () => {
    const { target, staged } = await fixture();
    await fs.writeFile(path.join(staged, "manifest.json"), "new manifest");
    await fs.writeFile(path.join(staged, "cell.json"), "new cell");

    await publishStagedDirectory({
      stagedDir: staged,
      targetDir: target,
      preserveFiles: ["README.md"],
      requiredFiles: ["manifest.json"],
    });

    expect(await fs.readFile(path.join(target, "README.md"), "utf8")).toBe("hand written");
    expect(await fs.readFile(path.join(target, "manifest.json"), "utf8")).toBe("new manifest");
    expect(await fs.readFile(path.join(target, "cell.json"), "utf8")).toBe("new cell");
  });

  it("leaves the current pack untouched when the staged pack is incomplete", async () => {
    const { target, staged } = await fixture();

    await expect(
      publishStagedDirectory({
        stagedDir: staged,
        targetDir: target,
        preserveFiles: ["README.md"],
        requiredFiles: ["manifest.json"],
      }),
    ).rejects.toThrow();

    expect(await fs.readFile(path.join(target, "manifest.json"), "utf8")).toBe("old manifest");
    expect(await fs.readFile(path.join(target, "README.md"), "utf8")).toBe("hand written");
  });
});
