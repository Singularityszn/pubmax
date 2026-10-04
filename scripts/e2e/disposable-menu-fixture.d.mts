import type { UkPriceBundleRow } from "../../lib/ukPriceBundle";

export const DISPOSABLE_MENU_FIXTURE: Readonly<{
  venueId: string;
  venueName: string;
  lat: number;
  lng: number;
  drinkLabel: string;
  servingSize: string;
  sourceUrl: string;
  priceGbp: number;
}>;

export function prepareDisposableMenuFixture(root: string): {
  backupDir: string;
  observedAt: string;
  restore(): void;
};

export function installDisposableMenuFixture(
  root: string,
  env?: NodeJS.ProcessEnv,
): UkPriceBundleRow;
