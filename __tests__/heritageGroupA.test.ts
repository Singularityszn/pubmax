import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

type HeritagePack = { listings: Record<string, { listEntry: number }> };

// Group A of Singularityszn/pubmax#2218 supplies these buildings and owners.
// Each building must survive under its curated id, with no second base id.
const GROUP_A = [
  { listEntry: 1065547, owner: "venue-jjzydh" },
  { listEntry: 1208567, owner: "venue-zkuv6d" },
  { listEntry: 1292548, owner: "venue-y0663t" },
  { listEntry: 1357232, owner: "venue-eo6xxr" },
  { listEntry: 1357775, owner: "venue-jria2z" },
  { listEntry: 1358392, owner: "venue-1qjqf84" },
  { listEntry: 1358443, owner: "venue-1m28qgb" },
  { listEntry: 1358519, owner: "venue-64dj8k" },
  { listEntry: 1358531, owner: "venue-10tonfm" },
  { listEntry: 1358766, owner: "venue-5nr401" },
  { listEntry: 1359323, owner: "venue-4t257p" },
  { listEntry: 1385870, owner: "venue-9x822c" },
  { listEntry: 1389397, owner: "venue-1744sjn" },
  { listEntry: 1391087, owner: "venue-87vk2x" },
  { listEntry: 1457610, owner: "venue-1ka9wr7" },
];

function venueIdsFor(pack: HeritagePack, listEntry: number) {
  return Object.entries(pack.listings)
    .filter(([, listing]) => listing.listEntry === listEntry)
    .map(([venueId]) => venueId);
}

describe("issue #2218 group A heritage ownership", () => {
  let committedText: string;
  let rebuiltText: string;
  let committed: HeritagePack;
  let rebuilt: HeritagePack;

  beforeAll(() => {
    committedText = readFileSync(join(process.cwd(), "public/data/heritage_listings.json"), "utf8");
    committed = JSON.parse(committedText);
    // Exercise the real join, including its read of the map's published owners.
    // Offline mode keeps the original source date and needs no network or key.
    rebuiltText = execFileSync(
      process.execPath,
      [join(process.cwd(), "scripts/build_heritage_listings.mjs"), "--offline", "--dry-run"],
      { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    rebuilt = JSON.parse(rebuiltText);
  });

  it.each(GROUP_A)("keeps listing $listEntry only under $owner", ({ listEntry, owner }) => {
    expect(venueIdsFor(committed, listEntry)).toEqual([owner]);
    expect(venueIdsFor(rebuilt, listEntry)).toEqual([owner]);
  });

  it("rebuilds the committed pack byte for byte from the recorded NHLE read", () => {
    expect(rebuiltText).toBe(committedText);
  });
});
