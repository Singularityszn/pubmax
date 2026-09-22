import type { DrinkCategory } from "@/lib/drinks";
import type { RobotsChecker } from "@/lib/harvest/robots";
import type { UkPriceReading } from "@/lib/harvest/ukPriceCrawl";

/** Every reason a document the OCR lane opened produced no price. */
export const OCR_DOCUMENT_OUTCOMES: readonly string[];

export type OcrFetchedPage = {
  ok: boolean;
  status: number;
  body: string;
  finalUrl: string;
  pdf?: boolean;
  bytes?: Uint8Array;
  error?: string;
};

/** Read one OCR discovery or document URL through source, robots and redirect guards. */
export function fetchOcrPage(
  url: string,
  robots: RobotsChecker,
  fetchImpl?: typeof fetch,
): Promise<OcrFetchedPage>;

/** One host the crawl recorded an unreadable PDF for, off the ledger's own evidence. */
export type UnreadablePdfHost = {
  host: string;
  unreadable: number;
  checkedAt: string | null;
};

export function hostsWithUnreadablePdfs(ledger: unknown): UnreadablePdfHost[];

/** A pub as the OSM snapshot states it, grouped under the host it names. */
export type OcrHostPub = {
  venueId: string | null;
  osmId: string | null;
  name: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  website: string;
};

export type OcrHostEntry = {
  host: string;
  origin: string;
  pubs: OcrHostPub[];
};

/** A harvest row, in the shape data/uk_prices/site_harvest.jsonl already carries. */
export type OcrPriceRow = {
  host: string;
  venueId: string | null;
  osmId: string | null;
  name: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  category: DrinkCategory;
  priceGbp: number;
  drinkLabel?: string;
  sourceUrl: string;
  observedAt: string;
  pubsOnHost: number;
  linesOnPage: number;
  reader: "olmocr";
};

export type OcrDocumentOutcome = {
  url: string;
  outcome: string;
  evidence?: string;
};

export function rowsFromReadings(
  entry: OcrHostEntry,
  readings: ReadonlyArray<{ url: string; reading: UkPriceReading }>,
  observedAt: string,
): { rows: OcrPriceRow[]; documents: OcrDocumentOutcome[] };
