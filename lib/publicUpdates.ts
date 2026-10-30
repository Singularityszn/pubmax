/**
 * Public notes describe released changes only. Add a row after checking the
 * production deployment and the change it contains. Never list an open PR.
 * Release receipts belong in docs/proof/, rather than in the reader's copy.
 */
export const PUBLIC_UPDATES = [
  {
    id: "2026-10-26-social-feeds-and-messages",
    date: "2026-10-26",
    title: "Better social feeds and messages",
    changes: [
      "Social feeds, finding people and messaging work better.",
    ],
  },
  {
    id: "2026-10-25-map-filters-and-menu-prices",
    date: "2026-10-25",
    title: "Pub feature filters and more menu prices",
    changes: [
      "The map can filter pubs by features we have a source for.",
      "Pub pages show listed coffee and alcohol-free prices from the menu.",
      "Ledger estimates no longer sit level with prices drinkers reported.",
      "Tonight says why some pub listings are hidden.",
      "Price source dates and Ledger warnings are easier to read.",
      "The header theme switch is back, and it keeps the look you picked.",
      "Day or Tonight opens by the time in London.",
      "After you sign in, you land back on PUBMAXX.",
      "New London guide words, photos and film.",
    ],
  },
  {
    id: "2026-10-22-london-menu-details",
    date: "2026-10-22",
    title: "Updated London menu details",
    changes: [
      "Updated sourced menu details for London bars and food stops.",
      "Removed listings we could not check from current recommendations.",
    ],
  },
  {
    id: "2026-10-19-london-prices-and-pub-pages",
    date: "2026-10-19",
    title: "More London menu prices, steadier pub pages",
    changes: [
      "Added more drink prices from London pubs' own published menus.",
      "The getting-home section on a pub page stays in place while extra price details load.",
    ],
  },
] as const;
