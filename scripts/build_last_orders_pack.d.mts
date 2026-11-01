export const LAST_ORDERS_HOURS_FILE: string;
export const LAST_ORDERS_PRICES_FILE: string;

export type LastOrdersHoursPackRow = [
  venueId: string,
  name: string,
  lat: number,
  lng: number,
  openingHours: string,
  hoursCheckDate: string,
];

export function isSourcedPint(slim: {
  cheapestPrice?: unknown;
  priceSource?: unknown;
  priceObservedAt?: unknown;
  anchorLabel?: unknown;
}): boolean;

export function buildLastOrdersPacks(input: {
  facts: {
    extractedAt?: string;
    rows: ReadonlyArray<{ osmId: string; openingHours?: string; hoursCheckDate?: string }>;
  };
  pubs: ReadonlyArray<{
    osmId?: string;
    name?: string;
    lat?: number;
    lng?: number;
    curatedRef?: { source?: string; id?: string };
  }>;
  slimRows: ReadonlyArray<{
    id?: string;
    cheapestPrice?: number;
    priceSource?: string;
    priceObservedAt?: string;
    anchorLabel?: string;
  }>;
  closed: { osmRefs?: readonly string[]; curatedVenueIds?: readonly string[] };
}): {
  hours: {
    version: 1;
    license: string;
    source: string;
    attribution: string;
    readOn: string;
    columns: string[];
    rows: LastOrdersHoursPackRow[];
  };
  prices: {
    version: 1;
    source: string;
    columns: string[];
    rows: Record<string, [priceGbp: number, observedAt: string]>;
  };
};
