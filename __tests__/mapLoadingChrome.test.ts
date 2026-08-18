import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");
const mapLoadingFrame = readFileSync(
  join(process.cwd(), "components/map/MapLoadingFrame.tsx"),
  "utf8",
);
const mapLoadingSkeleton = readFileSync(
  join(process.cwd(), "components/map/MapLoadingSkeleton.tsx"),
  "utf8",
);

describe("map loading chrome", () => {
  it("keeps mobile shell chrome off the held loading frame", () => {
    const gateIndex = pubMap.indexOf("{mobileShellReady ? (");
    const shellIndex = pubMap.indexOf("<MobileMapShell", gateIndex);

    expect(gateIndex).toBeGreaterThan(-1);
    expect(shellIndex).toBeGreaterThan(gateIndex);
  });

  it("does not claim first paint waits on tonight's prices", () => {
    expect(`${pubMap}\n${mapLoadingFrame}\n${mapLoadingSkeleton}`).not.toContain(
      "Fetching tonight",
    );
  });

  // The visible loading line is allowed a dry aside (docs/VOICE.md: jokes live
  // in loading lines). The ACCESSIBLE NAME is not: a screen-reader user should
  // hear what is happening, not the joke, so the aria-label states the fact and
  // nothing else.
  it("keeps the held frame's accessible name literal", () => {
    // Scan EVERY aria-label in both held frames, not the first one that
    // matches: a second held frame with a joke appended to its label has to
    // fail here.
    const labels =
      `${pubMap}\n${mapLoadingFrame}`.match(
        /aria-label=(?:"[^"]*"|\{`[^`]*`\}|\{[^}]*\})/g,
      ) ?? [];
    const loadingLabels = labels.filter((label) => label.includes("Loading"));

    expect(loadingLabels.length).toBeGreaterThan(0);
    for (const label of loadingLabels) {
      expect(label).toBe("aria-label={`Loading the ${mapDisplayName} pub map.`}");
    }
  });
});
