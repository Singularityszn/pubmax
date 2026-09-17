/**
 * THE QUICK-PRICE CHIPS WRAP ON A LADDER, AND THE LADDER IS A POLICY.
 *
 * The Pint Drop composer offers five common prices, plus the pub's own last
 * logged price when it has one. At 390px the row a composer gives them is
 * 268px wide and a chip is about 60px, so five need 324px: they wrap. The 6
 * September 2026 design review recorded that the wrap was ACCIDENTAL - it fell
 * out of `flex-wrap` and the chips' own text widths, so the fifth chip landed
 * wherever the fourth left off and a slightly wider label (a `last` tag, or
 * `£10.50`) silently re-cut the rows.
 *
 * A deliberate ladder is a COLUMN COUNT: the chips sit in an equal-column grid,
 * so five chips read as four and one, the fifth starts the second row in the
 * first column, and six read as four and two. Nothing is squeezed, because a
 * column is never narrower than the tap target the row already promised, and
 * the count does not change with the viewport: the composer's row is 269px in
 * the phone sheet and 238px in the desktop drawer, so a wider rung would have
 * squeezed the desktop chips to 43px to fit five across.
 *
 * The numbers live here rather than in the stylesheet so one module answers
 * "how many across?" for the composer, the fence and any future surface;
 * `__tests__/priceChipLadder.test.ts` holds components/map/spillComposer.module.css to
 * this table so the CSS and the policy cannot drift apart.
 */

/** Four across, at every width. */
export const PRICE_CHIP_COLUMNS = 4;

/** The narrowest a chip column may be: the shared control height. */
export const PRICE_CHIP_MIN_COLUMN_PX = 44;

/** The gap between two chips, mirrored by .priceQuickAdds. */
export const PRICE_CHIP_GAP_PX = 6;

/**
 * The composer's own chip row, measured on the shipped build: 269px inside the
 * phone sheet at 390, and 238px inside the desktop drawer at 1280. The desktop
 * row is the NARROWER of the two, which is why there is one rung rather than a
 * wider one above it - five 44px targets plus their gaps need 244px, and the
 * drawer has never had it.
 */
export const PRICE_CHIP_MEASURED_ROW_PX = { phone390: 269, desktop1280: 238 } as const;

/** The px a row needs to stand `columns` chips across without squeezing one. */
export function priceChipRowWidthFor(columns: number): number {
  return columns * PRICE_CHIP_MIN_COLUMN_PX + (columns - 1) * PRICE_CHIP_GAP_PX;
}

/** How many chips stand across. One answer, so no width can re-cut the rows. */
export function priceChipColumns(): number {
  return PRICE_CHIP_COLUMNS;
}

/**
 * The rows the ladder produces. Pure, and about the LADDER rather than about
 * any one chip list, so a caller can ask what six chips look like at four
 * across without rendering anything.
 */
export function priceChipRows<T>(chips: readonly T[], columns: number): T[][] {
  if (columns < 1) return chips.length ? [[...chips]] : [];
  const rows: T[][] = [];
  for (let index = 0; index < chips.length; index += columns) {
    rows.push(chips.slice(index, index + columns));
  }
  return rows;
}
