// THE OVERVIEW IS FIVE FOLDS (launch UX V1, 30 Oct 2026). The pub Overview
// grew to twenty-two blocks in one column, and a first-time reader scrolled
// past the price door to find the address. The blocks are grouped into five
// folds, in this order, and only Price is open when the sheet opens.
//
// This table is the whole order and every word a fold summary says. A summary
// states what is inside in pub words, never in plumbing words, and a test
// (`__tests__/venueOverviewFolds.test.tsx`) pins the order, the labels and the
// one open fold.

export type OverviewFoldKey = "price" | "tonight" | "journey" | "pub" | "record";

export type OverviewFold = {
  key: OverviewFoldKey;
  /** The summary's name for the fold. */
  label: string;
  /** One short line under the name: what the fold holds. */
  hint: string;
  /** Open on first render. Price alone. */
  defaultOpen: boolean;
};

export const OVERVIEW_FOLDS: readonly OverviewFold[] = [
  {
    key: "price",
    label: "Price",
    hint: "What a pint costs here, and how it compares",
    defaultOpen: true,
  },
  {
    key: "tonight",
    label: "Tonight",
    hint: "How busy it is, weather tips and I'm here",
    defaultOpen: false,
  },
  {
    key: "journey",
    label: "Getting there and home",
    hint: "Directions and the last way home",
    defaultOpen: false,
  },
  {
    key: "pub",
    label: "The pub",
    hint: "Address, hours, food, access and what people say",
    defaultOpen: false,
  },
  {
    key: "record",
    label: "Your record",
    hint: "Your visits, your lists and your next badge",
    defaultOpen: false,
  },
];

export function overviewFold(key: OverviewFoldKey): OverviewFold {
  const fold = OVERVIEW_FOLDS.find((entry) => entry.key === key);
  if (!fold) throw new Error(`Unknown Overview fold: ${key}`);
  return fold;
}
