import { describe, expect, it } from "vitest";

import { validatePostcodeCoordinateQuarantine } from "../scripts/lib/postcodeCoordinateConsistency.mjs";
import type { PostcodeCoordinateRow } from "../scripts/lib/postcodeCoordinateConsistency.mjs";

const lincolnRow = {
  app_price_id: "app_price_000339",
  pub_name: "The Lincoln Arms",
  address: "EN1 1QT",
  latitude: 51.5332,
  longitude: -0.1222,
};

const osmPubs = [
  {
    name: "Bush Hill Park",
    postcode: "EN1 1BA",
    lat: 51.6415276,
    lng: -0.0687715,
  },
];

const lincolnQuarantine = {
  appPriceId: "app_price_000339",
  pubName: "The Lincoln Arms",
  postcode: "EN1 1QT",
  latitude: 51.5332,
  longitude: -0.1222,
  reason:
    "Two real same-named pubs match opposing fields, so price ownership is unresolved.",
};

function validate(rows: PostcodeCoordinateRow[], quarantineRows: unknown[]) {
  return validatePostcodeCoordinateQuarantine({
    rows,
    osmPubs,
    quarantineRegistry: { rows: quarantineRows },
  });
}

describe("postcode-coordinate quarantine registry", () => {
  it("applies one exact, reasoned row decision", () => {
    const result = validate([lincolnRow], [lincolnQuarantine]);

    expect(result.invalidQuarantines).toEqual([]);
    expect(result.appliedQuarantines).toHaveLength(1);
    expect(result.unquarantinedContradictions).toEqual([]);
  });

  it.each([
    {
      label: "partial",
      rows: [{ ...lincolnQuarantine, longitude: undefined }],
      expected: "latitude and longitude must be finite numbers",
    },
    {
      label: "duplicate",
      rows: [lincolnQuarantine, lincolnQuarantine],
      expected: "duplicate appPriceId app_price_000339",
    },
    {
      label: "reasonless",
      rows: [{ ...lincolnQuarantine, reason: "" }],
      expected: "reason must contain at least 20 characters",
    },
    {
      label: "stale",
      rows: [
        { ...lincolnQuarantine, appPriceId: "app_price_999999" },
      ],
      expected: "app_price_999999 is not in the pre-publication dataset",
    },
    {
      label: "identity mismatch",
      rows: [{ ...lincolnQuarantine, pubName: "Another Lincoln Arms" }],
      expected: "identity fields do not exactly match app_price_000339",
    },
  ])("rejects a $label entry", ({ rows, expected }) => {
    const result = validate([lincolnRow], rows);

    expect(result.invalidQuarantines.join("\n")).toContain(expected);
  });

  it("rejects a no-longer-contradictory entry", () => {
    const consistentRow = {
      ...lincolnRow,
      latitude: 51.6415276,
      longitude: -0.0687715,
    };
    const result = validate(
      [consistentRow],
      [
        {
          ...lincolnQuarantine,
          latitude: consistentRow.latitude,
          longitude: consistentRow.longitude,
        },
      ],
    );

    expect(result.invalidQuarantines.join("\n")).toContain(
      "app_price_000339 is not a postcode-coordinate contradiction",
    );
  });

  it("rejects grouped or ambiguous app price ids", () => {
    const result = validate([lincolnRow], [
      {
        ...lincolnQuarantine,
        appPriceId: undefined,
        appPriceIds: ["app_price_000339", "app_price_000340"],
      },
    ]);

    expect(result.invalidQuarantines.join("\n")).toContain(
      "appPriceId must be non-empty",
    );
  });
});
