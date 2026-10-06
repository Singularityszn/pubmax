// The command registry for the ⌘K palette. A plain data module: every entry's
// `run` receives a CommandContext (navigate / close / toggleTheme) so this file
// never imports a router or touches the DOM. The navigation hrefs + labels are
// kept in lock-step with components/nav/SiteNav.tsx (the canonical app nav) so
// the palette can never drift to a dead route, and __tests__/commandPalette.test.ts
// fails when a destination the nav or the More menu names has no command here.

import type { Command } from "./types";

/**
 * Ordered registry. `Navigate` entries mirror SiteNav's primary row and its More
 * menu (plus the two utility destinations the nav exposes as icons — Messages +
 * Activity, and the Pint Index, which the nav does not link); the
 * `Actions` entries are the handful of first-class things you'd want to trigger
 * from anywhere. Every href resolves to a real App-Router route.
 */
export const commands: Command[] = [
  // ── Navigate ────────────────────────────────────────────────────────────
  {
    id: "nav-map",
    label: "Map",
    hint: "/map",
    keywords: ["explore", "pubs near me", "pints", "london"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/map"),
  },
  {
    id: "nav-tonight",
    label: "Tonight",
    hint: "/tonight",
    keywords: ["tonight", "today", "what's on", "now", "open now"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/tonight"),
  },
  {
    id: "nav-places",
    label: "Places",
    hint: "/places",
    keywords: ["cities", "city", "choose city", "areas", "where"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/places"),
  },
  {
    id: "nav-out",
    label: "Out",
    hint: "/out",
    keywords: ["events", "live music", "quiz", "gigs", "what's on", "going out"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/out"),
  },
  {
    id: "nav-near",
    label: "Near",
    hint: "/near",
    keywords: ["nearby", "near me", "close", "cheap pint", "pints near me"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/near"),
  },
  {
    id: "nav-historic",
    label: "Historic",
    hint: "/historic",
    keywords: ["history", "old pubs", "heritage", "oldest", "lore", "stories"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/historic"),
  },
  {
    id: "nav-wall",
    label: "Drink Wall",
    hint: "/wall",
    keywords: ["photos", "pictures", "pub fronts", "gallery", "wall"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/wall"),
  },
  {
    id: "nav-pal",
    label: "Pal",
    hint: "/pal",
    keywords: ["pub pal", "assistant", "concierge", "ask", "recommend", "ai"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/pal"),
  },
  {
    id: "nav-pint-index",
    label: "Pint Index",
    hint: "/pint-index",
    keywords: ["prices", "data", "london pint index", "average", "median", "ranking"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/pint-index"),
  },
  {
    id: "nav-pubs",
    label: "Chains",
    hint: "/pubs",
    keywords: [
      "pubs",
      "menus",
      "leaderboard",
      "cheapest",
      "prices",
      "ranking",
      "chain",
    ],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/pubs"),
  },
  {
    id: "nav-social",
    label: "Social",
    hint: "/social",
    keywords: ["updates", "activity", "latest", "stories"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/social"),
  },
  {
    id: "nav-discover",
    label: "Pubs & pints",
    hint: "/social?tab=discover",
    keywords: ["discover", "stories", "reads", "features"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/social?tab=discover"),
  },
  {
    id: "nav-borough",
    label: "Boroughs",
    hint: "/borough",
    keywords: ["areas", "neighbourhoods", "districts"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/borough"),
  },
  {
    id: "nav-crawls",
    label: "Crawls",
    hint: "/crawls",
    keywords: ["routes", "pub crawl", "tours", "itineraries"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/crawls"),
  },
  {
    id: "nav-rounds",
    label: "Rounds",
    hint: "/rounds",
    keywords: ["group", "join", "code", "session"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/rounds"),
  },
  {
    id: "nav-messages",
    label: "Messages",
    hint: "/messages",
    keywords: ["inbox", "dm", "chat", "direct message"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/messages"),
  },
  {
    id: "nav-activity",
    label: "Activity",
    hint: "/activity",
    keywords: ["notifications", "alerts", "bell", "updates"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/activity"),
  },
  {
    id: "nav-profile",
    label: "You",
    hint: "/u/you",
    keywords: ["profile", "account", "me", "saved"],
    group: "Navigate",
    run: (ctx) => ctx.navigate("/u/you"),
  },

  // ── Actions ─────────────────────────────────────────────────────────────
  {
    id: "action-pint-drop",
    label: "Drop a pint price",
    hint: "Open the composer",
    keywords: ["log", "add price", "report", "pint drop"],
    group: "Actions",
    run: (ctx) => ctx.navigate("/map?log=1"),
  },
  {
    id: "action-start-plan",
    label: "Start a plan",
    hint: "/plan",
    keywords: ["planner", "build", "itinerary", "night out"],
    group: "Actions",
    run: (ctx) => ctx.navigate("/plan"),
  },
  {
    id: "action-build-crawl",
    label: "Build a crawl on the map",
    hint: "/map",
    keywords: ["route", "plan crawl", "stops"],
    group: "Actions",
    run: (ctx) => ctx.navigate("/map"),
  },
  {
    id: "action-toggle-theme",
    label: "Toggle theme",
    hint: "Light / dark",
    keywords: ["dark", "light", "appearance", "mode", "night"],
    group: "Actions",
    run: (ctx) => ctx.toggleTheme(),
  },
];
