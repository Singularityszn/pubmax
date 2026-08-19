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
      /const timeoutNotice = revealTimeoutNotice\(reason, tileNoticeOwner, \{\s*basemapPainted: basemapTileReadyForPaint,\s*pinsPaintable: hasPinsPaintable\(\),\s*\}\);/,
    );
    // The ceiling reveals; it never tears the canvas down (a "Map couldn't
    // draw" card over pubs that were about to paint was the reported defect).
    expect(onReveal).not.toContain("reportMapError");
  });
});
