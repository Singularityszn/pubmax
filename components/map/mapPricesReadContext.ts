import { createContext } from "react";

/**
 * The bundled London pint collection date, or null where the map does not show
 * those prices. lib/dataFreshness.ts owns the caption wording.
 * The page builds it on the server from the freshness
 * registry, so neither loading screen pulls the registry into the map bundle,
 * and both read it from here (site review, 18 Oct 2026: "the map opens on a
 * 'Loading pubs' shell").
 */
export const MapPricesReadContext = createContext<string | null>(null);
