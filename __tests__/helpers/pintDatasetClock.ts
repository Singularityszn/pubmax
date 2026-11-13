import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { latestPriceRowRead, priceRowReadDay } from "@/lib/priceReadDay.mjs";
import dataset from "@/public/data/pint_prices_app_dataset.json";

/**
 * A moment on the collection day after every bundled read. The registry stamp
 * is noon, and a collection that ran in the afternoon reads later than that.
 */
export const PINT_DATASET_TEST_NOW =
  Math.max(PINT_DATASET_OBSERVED_AT.getTime(), latestPriceRowRead(dataset) ?? 0) + 1_000;

const DAY_WORDS = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The London day a bundled row was read, as `YYYY-MM-DD` and in the words the app prints. */
export function bundledReadDay(appPriceId: string): { iso: string; words: string } {
  const iso = priceRowReadDay(dataset.find((row) => row.app_price_id === appPriceId));
  if (!iso) throw new Error(`${appPriceId} records no read`);
  return { iso, words: DAY_WORDS.format(new Date(`${iso}T12:00:00Z`)) };
}
