import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readValidatedMenuPageCache,
  writeMenuPageCache,
} from "@/scripts/lib/harvestMenuCache.mjs";

const REQUESTED_URL = "https://www.greeneking.co.uk/pub/menu";
const FINAL_URL = `${REQUESTED_URL}?canonical=1`;
const temporaryRoots: string[] = [];

function fixturePath() {
  const root = mkdtempSync(join(tmpdir(), "pubmax-menu-cache-"));
  temporaryRoots.push(root);
  mkdirSync(root, { recursive: true });
  return { root, markdownPath: join(root, "menu.md") };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("harvest menu cache binding", () => {
  it("returns a cache only when metadata is bound to the exact markdown bytes", async () => {
    const { markdownPath } = fixturePath();
    writeMenuPageCache({
      requestedUrl: REQUESTED_URL,
      markdownPath,
      page: { markdown: "## Drinks\nDiet Coke £3.20", finalUrl: FINAL_URL },
    });
    const validateResolvedMenuUrl = vi.fn(async (_requested: string, final: string) => final);

    await expect(
      readValidatedMenuPageCache({
        requestedUrl: REQUESTED_URL,
        markdownPath,
        validateResolvedMenuUrl,
      }),
    ).resolves.toEqual({
      markdown: "## Drinks\nDiet Coke £3.20\n",
      finalUrl: FINAL_URL,
    });
  });

  it("misses a torn pair whose markdown changed after metadata committed", async () => {
    const { markdownPath } = fixturePath();
    writeMenuPageCache({
      requestedUrl: REQUESTED_URL,
      markdownPath,
      page: { markdown: "## Drinks\nDiet Coke £3.20", finalUrl: FINAL_URL },
    });
    writeFileSync(markdownPath, "## Drinks\nDiet Coke £99.00\n");
    const validateResolvedMenuUrl = vi.fn(async (_requested: string, final: string) => final);

    await expect(
      readValidatedMenuPageCache({
        requestedUrl: REQUESTED_URL,
        markdownPath,
        validateResolvedMenuUrl,
      }),
    ).resolves.toBeNull();
    expect(validateResolvedMenuUrl).not.toHaveBeenCalled();
  });

  it("misses interrupted cache writes with no committed metadata", async () => {
    const { markdownPath } = fixturePath();
    writeFileSync(markdownPath, "## Drinks\nDiet Coke £3.20\n");

    await expect(
      readValidatedMenuPageCache({
        requestedUrl: REQUESTED_URL,
        markdownPath,
        validateResolvedMenuUrl: vi.fn(),
      }),
    ).resolves.toBeNull();
  });

  it("atomically replaces both files and leaves no temporary writes", () => {
    const { root, markdownPath } = fixturePath();
    writeFileSync(markdownPath, "stale markdown\n");
    writeFileSync(`${markdownPath}.source.json`, '{"finalUrl":"stale"}\n');

    writeMenuPageCache({
      requestedUrl: REQUESTED_URL,
      markdownPath,
      page: { markdown: "fresh markdown", finalUrl: FINAL_URL },
    });

    expect(readFileSync(markdownPath, "utf8")).toBe("fresh markdown\n");
    expect(JSON.parse(readFileSync(`${markdownPath}.source.json`, "utf8"))).toMatchObject({
      requestedUrl: REQUESTED_URL,
      finalUrl: FINAL_URL,
      markdownSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(readdirSync(root).sort()).toEqual(["menu.md", "menu.md.source.json"]);
  });
});
