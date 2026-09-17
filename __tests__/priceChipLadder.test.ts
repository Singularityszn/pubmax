import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRICE_CHIP_COLUMNS,
  PRICE_CHIP_GAP_PX,
  PRICE_CHIP_MEASURED_ROW_PX,
  PRICE_CHIP_MIN_COLUMN_PX,
  priceChipColumns,
  priceChipRowWidthFor,
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
  it("stands four across, at every width", () => {
    expect(PRICE_CHIP_COLUMNS).toBe(4);
    expect(priceChipColumns()).toBe(4);
  });

  it("is four rather than five because the DESKTOP row is the narrow one", () => {
    // Measured on the shipped build: the phone sheet gives the row 269px and
    // the desktop drawer 238px. Five 44px targets need 244px, so a wider rung
    // would squeeze the desktop chips (it measured 43px when one was tried).
    expect(priceChipRowWidthFor(5)).toBeGreaterThan(PRICE_CHIP_MEASURED_ROW_PX.desktop1280);
    expect(priceChipRowWidthFor(PRICE_CHIP_COLUMNS)).toBeLessThanOrEqual(
      PRICE_CHIP_MEASURED_ROW_PX.desktop1280,
    );
    expect(priceChipRowWidthFor(PRICE_CHIP_COLUMNS)).toBeLessThanOrEqual(
      PRICE_CHIP_MEASURED_ROW_PX.phone390,
    );
  });

  it("cuts the shipped five prices as four and one, with the fifth starting a row", () => {
    const chips = mergePriceChips(QUICK_ADD_PRICES_GBP, null);
    expect(chips).toHaveLength(5);
    const rows = priceChipRows(chips, priceChipColumns());
    expect(rows.map((row) => row.length)).toEqual([4, 1]);
    // The fifth chip is the FIRST cell of the second row, which is what makes
    // it a ladder rather than an orphan wherever the fourth chip ended.
    expect(rows[1]?.[0]).toBe(chips[4]);
  });

  it("cuts six as four and two when the pub's own last price leads", () => {
    const chips = mergePriceChips(QUICK_ADD_PRICES_GBP, 4.8);
    expect(chips).toHaveLength(6);
    expect(priceChipRows(chips, priceChipColumns()).map((row) => row.length)).toEqual([4, 2]);
  });

  it("never squeezes a column below the tap target the row promised", () => {
    for (const rowPx of Object.values(PRICE_CHIP_MEASURED_ROW_PX)) {
      const column =
        (rowPx - PRICE_CHIP_GAP_PX * (PRICE_CHIP_COLUMNS - 1)) / PRICE_CHIP_COLUMNS;
      expect(column).toBeGreaterThanOrEqual(PRICE_CHIP_MIN_COLUMN_PX);
    }
  });

  it("holds the composer stylesheet to these numbers", () => {
    const base = composerCss.match(/\.priceQuickAdds\s*{([^}]*)}/)?.[1] ?? "";
    expect(base).toMatch(/display:\s*grid/);
    expect(base).toMatch(
      new RegExp(`grid-template-columns:\\s*repeat\\(${PRICE_CHIP_COLUMNS}, minmax\\(0, 1fr\\)\\)`),
    );
    expect(base).toMatch(new RegExp(`gap:\\s*${PRICE_CHIP_GAP_PX}px`));
    // A flex wrap is what made the old rows accidental, and a second column
    // count behind a media query would be a second answer.
    expect(base).not.toMatch(/flex-wrap/);
    expect(composerCss).not.toMatch(/@media[^{]*{\s*\.priceQuickAdds/);
  });

  it("gives the chip that carries a word beside its figure two columns", () => {
    expect(composerCss).toMatch(/\.priceChip--tagged\s*{[^}]*grid-column:\s*span 2/);
  });
});
