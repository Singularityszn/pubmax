import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const wordmarkCss = readFileSync(
  join(process.cwd(), "components/brand/pubmaxxWordmark.css"),
  "utf8",
);
const wordmarkTsx = readFileSync(
  join(process.cwd(), "components/brand/PubmaxxWordmark.tsx"),
  "utf8",
);

describe("PubmaxxWordmark wrap contract", () => {
  it("keeps PUBMA, the doubled X and ING on one nowrap row", () => {
    expect(wordmarkCss).toMatch(/\.pubmaxxWordmarkLetters\s*\{[\s\S]*flex-wrap:\s*nowrap/);
    expect(wordmarkCss).toMatch(/\.pubmaxxWordmarkLetters\s*\{[\s\S]*white-space:\s*nowrap/);
    expect(wordmarkTsx).toContain('className="pubmaxxWordmarkLetters"');
    expect(wordmarkTsx).toMatch(/<span>PUBMA<\/span>[\s\S]*pubmaxxDoubleX[\s\S]*<span>ING<\/span>/);
  });
});
