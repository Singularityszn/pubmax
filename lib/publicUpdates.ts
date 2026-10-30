/**
 * Public notes describe released changes only. Add a row after checking the
 * production deployment and the change it contains. Never list an open PR.
 * Release receipts belong in docs/proof/, rather than in the reader's copy.
 * A row's date is not a release day unless a receipt shows it: the rows from
 * 25 Oct on carry the day their pull requests merged, and the page claims no
 * more than that the changes are live.
 */
export const PUBLIC_UPDATES = [
  {
    id: "2026-10-30-sun-compass-offline-crawls",
    date: "2026-10-30",
    title: "Gardens in the sun, a pint compass and offline crawls",
    changes: [
      "In the sun shows which pub gardens are likely in the sun, now and for the next 6 hours.",
      "Pint Compass points at the cheapest listed pint near you.",
      "Crawl stops still open when you lose signal.",
      "The Pals move their mouths when they talk.",
      "Loading screens ask a pub quiz question, and the answer links to Historic England.",
      "The streets stay on screen from the opening picture to the live map.",
      "Find your lot keeps the handle you typed.",
      "On Tonight, Why this pub works with a keyboard and a screen reader.",
      "Addresses people type, like /coffee and /data-credits, now open the right page.",
    ],
  },
  {
    id: "2026-10-28-year-in-pints-sharing",
    date: "2026-10-28",
    title: "Share your Year in Pints, and steadier listings",
    changes: [
      "You can share your Year in Pints, free.",
      "Sourced pub quiz listings are back, and each pub keeps its own card.",
      "The map no longer opens on another town from a saved page.",
      "Public holiday opening hours are kept, and midnight closing times read correctly.",
    ],
  },
  {
    id: "2026-10-27-homepage-phone-controls",
    date: "2026-10-27",
    title: "Clearer homepage on phones",
    changes: [
      "Homepage buttons no longer sit under the floating controls on phones.",
    ],
  },
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
