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
    id: "2026-11-10-guinness-prices-and-zone-estimates",
    date: "2026-11-10",
    title: "Guinness prices across the UK, and London zone estimates",
    changes: [
      "Pub sheets and map pins show Guinness prices listed by Guinndex, for pubs across the UK.",
      "A London pub with no listed pint can show an estimate, marked as one. It's the middle listed price for pubs in the same fare zone.",
      "Beer-by-area pages are back, and they say what to expect at a pub that lists no price.",
    ],
  },
  {
    id: "2026-11-09-fresh-listings-quicker-map",
    date: "2026-11-09",
    title: "Fresher listed prices, a quicker map and order compare",
    changes: [
      "We read the Pint Prices listings again on 9 November. 55 prices changed.",
      "Priced pins show up sooner when the map opens on a phone.",
      "/tools compares the same order at two or three London pubs, with the walk between them.",
    ],
  },
  {
    id: "2026-11-07-crawls-in-other-cities",
    date: "2026-11-07",
    title: "Crawls in other cities",
    changes: [
      "The crawls page now lists routes in other cities too, such as Manchester.",
    ],
  },
  {
    id: "2026-11-03-illustrated-pub-signs",
    date: "2026-11-03",
    title: "Drawn signs for pubs with no photo",
    changes: [
      "A pub with no usable photo shows an illustrated sign with its own name.",
    ],
  },
  {
    id: "2026-11-01-tables-twenty-pound-crawl-dry-round",
    date: "2026-11-01",
    title: "Ask for a table, a £20 crawl and a Dry round",
    changes: [
      "Pub sheets have Ask for a table, for a group of 6 to 20. It's free.",
      "On a wider screen, a list of the pubs in view sits beside the map, cheapest or nearest first.",
      "Plan can build a £20 crawl: stops whose listed pints add up to £20 or less.",
      "Dry round plans stops that list an alcohol-free price, with the pint price beside it.",
      "Cheapest pints near me has Pint roulette: one pub at random with a listed pint, within 15 minutes' walk.",
      "On You, tap the pubs you've been to and they start your Been here list.",
    ],
  },
  {
    id: "2026-10-30-sun-compass-offline-crawls",
    date: "2026-10-30",
    title: "Gardens in the sun, a pint compass and offline crawls",
    changes: [
      "In the sun shows which pub gardens are likely in the sun, now and for the next 6 hours.",
      "Pint Compass points at the cheapest listed pint near you.",
      "Crawl stop pages you saved earlier can open without signal. Pages save while you have signal, but not with Data Saver on.",
      "The Pals move their mouths when they talk.",
      "Loading screens ask a pub quiz question, and the answer links to Historic England.",
      "Fewer blank moments between the opening map picture and the live map.",
      "Find your lot keeps the handle you typed.",
      "On Tonight, Why this pub works with a keyboard and a screen reader.",
      "Addresses people type, like /coffee and /data-credits, now open the right page.",
      "/gardens opens the map with the Beer garden filter on.",
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
