// F12: the registry's own prose is part of the data path.
//
// `price_updates` described its envelope date as naming one fixed collection
// day (2026-07-03) while the shipped envelope carried 2026-09-04. Nobody was
// wrong about the RULE, which is that the empty envelope tracks the bundled
// pint dataset's collection day; the prose named a day, and days move. This
// holds the two to each other so the sentence cannot rot again, and it never
// restamps anything: the envelope has no rows to restamp.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

type Dataset = {
  id: string;
  class: string;
  artifact: string | null;
  refreshWorkflow: string;
  stalenessBudgetHours: number | null;
  stamp: { kind: string; value?: string } | null;
};

const registry = JSON.parse(
  readFileSync(path.join(ROOT, "data", "freshness_registry.json"), "utf8"),
) as { datasets: Dataset[] };

function dataset(id: string): Dataset {
  const found = registry.datasets.find((entry) => entry.id === id);
  expect(found, `registry holds ${id}`).toBeDefined();
  return found as Dataset;
}

describe("price_updates prose and envelope agree", () => {
  const priceUpdates = dataset("price_updates");

  it("still ships an EMPTY envelope, which is what makes its date an envelope date", () => {
    const envelope = JSON.parse(
      readFileSync(path.join(ROOT, priceUpdates.artifact as string), "utf8"),
    ) as { updates: unknown[]; generatedAt: string };
    expect(envelope.updates).toEqual([]);
    expect(Number.isFinite(Date.parse(envelope.generatedAt))).toBe(true);
  });

  it("names no fixed collection day, because the day it tracks moves", () => {
    // A date typed into prose is a claim that ages out with nothing saying so.
    expect(priceUpdates.refreshWorkflow).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });

  it("says what the envelope date actually means", () => {
    expect(priceUpdates.refreshWorkflow).toMatch(/dates NO observation/i);
    expect(priceUpdates.refreshWorkflow).toMatch(/envelope date/i);
  });

  it("keeps the envelope aligned to the bundled dataset's own collection day", () => {
    // The rule the prose states, checked against the two stamps rather than
    // asserted about one of them. The bundled dataset's collection day is the
    // registry's own literal stamp, which lib/dataFreshness.ts derives from.
    const pintStamp = registry.datasets.find((entry) => entry.id === "pint_prices")?.stamp;
    expect(pintStamp?.kind).toBe("literal");
    const envelope = JSON.parse(
      readFileSync(path.join(ROOT, priceUpdates.artifact as string), "utf8"),
    ) as { generatedAt: string };
    expect(new Date(envelope.generatedAt).toISOString().slice(0, 10)).toBe(
      new Date(pintStamp?.value as string).toISOString().slice(0, 10),
    );
  });
});
