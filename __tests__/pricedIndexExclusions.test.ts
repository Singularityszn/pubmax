import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PRICED_INDEX_EXCLUSIONS_FILE,
  findExcludedPricedRows,
  isValidExclusionEntry,
  pricedRowExclusionMatch,
} from "../scripts/lib/pricedIndexExclusions.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT_DIR = join(__dirname, "..");

const EXCLUSION = {
  name: "Liberty London",
  address: "Regent St., Carnaby, London W1B 5AH",
  reason: "Department store, not a drinking venue. Issue #1463.",
};

describe("priced index exclusions", () => {
  it("matches a row on name and address, case- and whitespace-insensitively", () => {
    const row = { pub_name: "  liberty LONDON  ", address: "regent st., carnaby, london w1b 5ah" };
    expect(pricedRowExclusionMatch(row, [EXCLUSION])).toEqual(EXCLUSION);
  });

  it("does not match a same-named row at a different address", () => {
    const row = { pub_name: "Liberty London", address: "Somewhere else, London" };
    expect(pricedRowExclusionMatch(row, [EXCLUSION])).toBeNull();
  });

  it("does not match an ordinary pub row", () => {
    const row = { pub_name: "Hope & Anchor", address: "207 Upper Street, N1 1RL" };
    expect(pricedRowExclusionMatch(row, [EXCLUSION])).toBeNull();
  });

  it("finds every excluded row across a dataset by index", () => {
    const rows = [
      { pub_name: "Hope & Anchor", address: "207 Upper Street, N1 1RL" },
      { pub_name: "Liberty London", address: "Regent St., Carnaby, London W1B 5AH" },
    ];
    const found = findExcludedPricedRows(rows, [EXCLUSION]);
    expect(found).toHaveLength(1);
    expect(defined(found[0]).index).toBe(1);
    expect(defined(found[0]).exclusion).toEqual(EXCLUSION);
  });

  it("requires a non-empty name, address and reason", () => {
    expect(isValidExclusionEntry(EXCLUSION)).toBe(true);
    expect(isValidExclusionEntry({ name: "", address: "x", reason: "y" })).toBe(false);
    expect(isValidExclusionEntry({ name: "x", address: "", reason: "y" })).toBe(false);
    expect(isValidExclusionEntry({ name: "x", address: "y", reason: "" })).toBe(false);
    expect(isValidExclusionEntry(null)).toBe(false);
  });

  // Regression: Liberty London (a department store) shipped in the priced
  // near-you rail wearing a pub kind (#1463). The excluded-venue list is the
  // guard; the shipped dataset must never carry a row that matches one of its
  // entries.
  it("keeps every excluded venue out of the shipped priced dataset", () => {
    const exclusions = JSON.parse(
      readFileSync(join(ROOT_DIR, PRICED_INDEX_EXCLUSIONS_FILE), "utf8"),
    );
    const rows = JSON.parse(
      readFileSync(
        join(ROOT_DIR, "public", "data", "pint_prices_app_dataset.json"),
        "utf8",
      ),
    );
    expect(findExcludedPricedRows(rows, exclusions)).toEqual([]);
  });
});
