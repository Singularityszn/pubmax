/**
 * Public notes describe released changes only. Add a row after checking the
 * production deployment and the change it contains. Never list an open PR.
 * Release receipts belong in docs/proof/, rather than in the reader's copy.
 */
export const PUBLIC_UPDATES = [
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
