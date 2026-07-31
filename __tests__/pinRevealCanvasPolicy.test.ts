import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const canvas = readFileSync(
  join(process.cwd(), "components/PubMapCanvas.tsx"),
  "utf8",
);

describe("pin reveal canvas policy", () => {
  it("delegates every remaining timeout to the basemap retry policy", () => {
    const onReveal = canvas.match(
      /onReveal: \(reason, generation\) => \{[\s\S]*?\n      \},\n    \}\);/,
    )?.[0];

    expect(onReveal).toMatch(
      /const basemapRetry = basemapRetryForReveal\(\s*reason,\s*tileNoticeOwner\s*\);/,
    );
  });
});
