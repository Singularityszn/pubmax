// Data files that define which remote image hosts /api/image-proxy may fetch.
// Plain ESM lets request-time reader and Next tracing config consume one list.
// Only photo fields are read. Link and free-text fields are never trusted.

import { VENUE_MENU_ENRICHMENT_FILE } from "./venueMenuEnrichmentFile.mjs";

export const VENUE_IMAGE_HOST_TILE_PHOTO_FILE = VENUE_MENU_ENRICHMENT_FILE;

export const VENUE_IMAGE_HOST_PHOTO_FIELD_FILE =
  "public/data/pint_prices_app_dataset.json";

export const VENUE_IMAGE_HOST_TRACING_INCLUDES = [
  VENUE_IMAGE_HOST_TILE_PHOTO_FILE,
  VENUE_IMAGE_HOST_PHOTO_FIELD_FILE,
].map(file => `./${file}`);
