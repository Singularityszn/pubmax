import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRICE_CHIP_MIN_COLUMN_PX,
  PRICE_CHIP_PHONE_COLUMNS,
  PRICE_CHIP_WIDE_COLUMNS,
  PRICE_CHIP_WIDE_MIN_WIDTH_PX,
  priceChipColumns,
  priceChipRows,
} from "@/lib/priceChipLadder";
import { QUICK_ADD_PRICES_GBP } from "@/lib/spill";
import { mergePriceChips } from "@/lib/spillPreview";

// THE LADDER IS A POLICY, and this holds the composer's stylesheet to it. The
// five quick prices wrapped at 390 because the row is 268px and five chips need
// 324px; what the 6 September 2026 review recorded was that the wrap was
// ACCIDENTAL, so a wider label re-cut the rows. Four across is now stated once,
// in lib/priceChipLadder.ts, and the CSS reads the same numbers.

const ROOT = process.cwd();
const composerCss = readFileSync(join(ROOT, "components/map/spillComposer.css"), "utf8");

describe("the quick-price chip ladder", () => {
  it("stands four across on a phone and five once there is room", () => {
    expect(PRICE_CHIP_PHONE_COLUMNS).toBe(4);
    expect(PRICE_CHIP_WIDE_COLUMNS).toBe(5);
    expect(priceChipColumns(390)).toBe(PRICE_CHIP_PHONE_COLUMNS);
    expect(priceChipColumns(PRICE_CHIP_WIDE_MIN_WIDTH_PX - 1)).toBe(PRICE_CHIP_PHONE_COLUMNS);
    expect(priceChipColumns(PRICE_CHIP_WIDE_MIN_WIDTH_PX)).toBe(PRICE_CHIP_WIDE_COLUMNS);
    expect(priceChipColumns(1280)).toBe(PRICE_CHIP_WIDE_COLUMNS);
  });

  it("cuts the shipped five prices as four and one, with the fifth starting a row", () => {
    const chips = mergePriceChips(QUICK_ADD_PRICES_GBP, null);
    expect(chips).toHaveLength(5);
    const rows = priceChipRows(chips, priceChipColumns(390));
    expect(rows.map((row) => row.length)).toEqual([4, 1]);
    // The fifth chip is the FIRST cell of the second row, which is what makes
    // it a ladder rather than an orphan wherever the fourth chip ended.
    expect(rows[1]?.[0]).toBe(chips[4]);
  });

  it("cuts six as four and two when the pub's own last price leads", () => {
    const chips = mergePriceChips(QUICK_ADD_PRICES_GBP, 4.8);
    expect(chips).toHaveLength(6);
    expect(priceChipRows(chips, priceChipColumns(390)).map((row) => row.length)).toEqual([4, 2]);
  });

  it("never squeezes a column below the tap target the row promised", () => {
    // 390px phone, the composer's own 268px row, three 6px gaps.
    const rowPx = 268;
    const gapPx = 6;
    const column =
      (rowPx - gapPx * (PRICE_CHIP_PHONE_COLUMNS - 1)) / PRICE_CHIP_PHONE_COLUMNS;
    expect(column).toBeGreaterThanOrEqual(PRICE_CHIP_MIN_COLUMN_PX);
  });

  it("holds the composer stylesheet to these numbers", () => {
    const base = composerCss.match(/\.priceQuickAdds\s*{([^}]*)}/)?.[1] ?? "";
    expect(base).toMatch(/display:\s*grid/);
    expect(base).toMatch(
      new RegExp(`grid-template-columns:\\s*repeat\\(${PRICE_CHIP_PHONE_COLUMNS}, minmax\\(0, 1fr\\)\\)`),
    );
    // A flex wrap is what made the old rows accidental.
    expect(base).not.toMatch(/flex-wrap/);
    expect(composerCss).toMatch(
      new RegExp(
        `@media \\(min-width: ${PRICE_CHIP_WIDE_MIN_WIDTH_PX}px\\)\\s*{\\s*\\.priceQuickAdds\\s*{\\s*grid-template-columns:\\s*repeat\\(${PRICE_CHIP_WIDE_COLUMNS}, minmax\\(0, 1fr\\)\\)`,
      ),
    );
  });

  it("gives the chip that carries a word beside its figure two columns", () => {
    expect(composerCss).toMatch(/\.priceChip--tagged\s*{[^}]*grid-column:\s*span 2/);
  });
});
