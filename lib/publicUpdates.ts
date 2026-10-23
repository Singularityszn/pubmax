/**
 * Public notes describe released changes only. Add a row after checking the
 * production deployment and the change it contains. Never list an open PR.
 * Release receipts belong in docs/proof/, rather than in the reader's copy.
 */
export const PUBLIC_UPDATES = [
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
