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
  await fs.writeFile(
    path.join(target, "manifest.json"),
    JSON.stringify({
      version: 1,
      shards: [
        {
          id: "old",
          core: false,
          url: "/data/uk_base/old.json",
          count: 1,
          bbox: [-1, 53, 0, 54],
        },
      ],
    }),
  );
  await fs.writeFile(path.join(target, "old.json"), "old shard");
  return { target, staged };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("publishStagedDirectory", () => {
  it("publishes a complete staged pack while preserving the handwritten README", async () => {
    const { target, staged } = await fixture();
    await fs.writeFile(
      path.join(staged, "manifest.json"),
      JSON.stringify({
        version: 1,
        shards: [
          {
            id: "cell",
            core: false,
            url: "/data/uk_base/cell.json",
            count: 1,
            bbox: [-1, 53, 0, 54],
          },
        ],
      }),
    );
    await fs.writeFile(path.join(staged, "cell.json"), "new cell");

    await publishStagedDirectory({
      stagedDir: staged,
      targetDir: target,
      requiredFiles: ["manifest.json"],
    });

    expect(await fs.readFile(path.join(target, "README.md"), "utf8")).toBe("hand written");
    const manifest = JSON.parse(
      await fs.readFile(path.join(target, "manifest.json"), "utf8"),
    ) as {
      previousGenerations: string[];
      shards: Array<{ url: string }>;
    };
    expect(manifest.shards[0].url).toMatch(
      /^\/data\/uk_base\/packs\/[a-f0-9]{16}\/cell\.json$/,
    );
    expect(manifest.previousGenerations).toEqual(["legacy"]);
    expect(
      await fs.readFile(
        path.join(target, manifest.shards[0].url.replace("/data/uk_base/", "")),
        "utf8",
      ),
    ).toBe("new cell");
    expect(await fs.readFile(path.join(target, "old.json"), "utf8")).toBe("old shard");
  });

  it("leaves the current pack untouched when the staged pack is incomplete", async () => {
    const { target, staged } = await fixture();

    await expect(
      publishStagedDirectory({
        stagedDir: staged,
        targetDir: target,
        requiredFiles: ["manifest.json"],
      }),
    ).rejects.toThrow();

    const manifest = JSON.parse(
      await fs.readFile(path.join(target, "manifest.json"), "utf8"),
    ) as { shards: Array<{ url: string }> };
    expect(manifest.shards[0].url).toBe("/data/uk_base/old.json");
    expect(await fs.readFile(path.join(target, "old.json"), "utf8")).toBe("old shard");
    expect(await fs.readFile(path.join(target, "README.md"), "utf8")).toBe("hand written");
  });
});
