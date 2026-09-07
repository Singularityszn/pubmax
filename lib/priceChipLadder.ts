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
 * column is never narrower than the tap target the row already promised.
 *
 * The numbers live here rather than in the stylesheet so one module answers
 * "how many across?" for the composer, the fence and any future surface;
 * `__tests__/priceChipLadder.test.ts` holds components/map/spillComposer.css to
 * this table so the CSS and the policy cannot drift apart.
 */

/** Columns on a phone: four 60px chips plus three gaps fit the 268px row. */
export const PRICE_CHIP_PHONE_COLUMNS = 4;

/** Columns once the composer is wide enough for the whole base list. */
export const PRICE_CHIP_WIDE_COLUMNS = 5;

/** The one step in the ladder, in px: the width the wide count starts at. */
export const PRICE_CHIP_WIDE_MIN_WIDTH_PX = 480;

/** The narrowest a chip column may be: the shared control height. */
export const PRICE_CHIP_MIN_COLUMN_PX = 44;

/** How many chips stand across at this viewport width. */
export function priceChipColumns(viewportWidthPx: number): number {
  return viewportWidthPx >= PRICE_CHIP_WIDE_MIN_WIDTH_PX
    ? PRICE_CHIP_WIDE_COLUMNS
    : PRICE_CHIP_PHONE_COLUMNS;
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
