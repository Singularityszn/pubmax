// Every Price Pulse edition file, registered once. Static imports keep the
// files inside the route's bundle, so no runtime read needs file tracing.
//
// `npm run price-pulse:draft` adds the next edition's two lines between the
// markers. `__tests__/pricePulse.test.tsx` fails when a file in
// data/price-pulse/ is missing from this list, so a draft cannot sit
// unregistered and an approval cannot go unseen.
//
// Only the /price-pulse route may import this module (see lib/pricePulse.ts).

// price-pulse:imports:start
import edition20261016 from "@/data/price-pulse/2026-10-16.json";
// price-pulse:imports:end

/** Raw edition files, unparsed. Read them through `publishedEditions`. */
export const PRICE_PULSE_EDITION_FILES: readonly unknown[] = [
  // price-pulse:list:start
  edition20261016,
  // price-pulse:list:end
];
