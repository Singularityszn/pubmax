import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type AppPriceRow = {
  app_price_id: string;
  pub_name: string;
  address: string;
  latitude: number;
  longitude: number;
};

const appRows = JSON.parse(
  readFileSync(
    join(process.cwd(), "public/data/pint_prices_app_dataset.json"),
    "utf8",
  ),
) as AppPriceRow[];

describe("postcode-coordinate consistency", () => {
  it("does not ship the Lincoln Arms row that conflates Enfield with King's Cross", () => {
    const contradictoryRow = appRows.find(
      (row) =>
        row.pub_name === "The Lincoln Arms" &&
        row.address === "EN1 1QT" &&
        row.latitude === 51.5332 &&
        row.longitude === -0.1222,
    );

    expect(contradictoryRow).toBeUndefined();
  });
});
