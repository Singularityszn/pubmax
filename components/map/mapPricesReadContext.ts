import { createContext } from "react";

/**
 * When the map's newest London price was read, as one line ("Newest London
 * price read 2 October 2026."), or null where the map is not about London's
 * bundled prices. The page builds it on the server from the freshness
 * registry, so neither loading screen pulls the registry into the map bundle,
 * and both read it from here (site review, 18 Oct 2026: "the map opens on a
 * 'Loading pubs' shell").
 */
export const MapPricesReadContext = createContext<string | null>(null);
