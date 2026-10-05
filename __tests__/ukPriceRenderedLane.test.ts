import { EventEmitter } from "node:events";
import path from "node:path";
import { appendFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { dedupeSiteHarvestLedgerRows } from "@/lib/siteHarvestLedgerCore";
import { defined } from "@/__tests__/helpers/defined";

vi.mock("node:fs", () => ({
  existsSync: (file: string) => file.endsWith("uk_osm_pubs.json"),
  readFileSync: () => JSON.stringify([{
    osmId: "node/1",
    name: "The Crown",
    website: "https://www.greeneking.co.uk/pubs/london/crown",
  }]),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock("@/lib/harvest/robots.ts", () => ({
  createRobotsChecker: () => async () => ({ allowed: true }),
}));

vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.emit("data", JSON.stringify({
        http_status: 200,
        markdown: `<p>${"Welcome to our drinks menu. ".repeat(20)}</p>
          <p>Chardonnay, France<br />125ml £5.50 250ml £11.00 Btl £31.50</p>
          <p>Rioja, Spain<br />125ml £5.25 250ml £10.50 Btl £30.00</p>
          <p>${"Welcome to our drinks menu. ".repeat(10)}</p>
          <p>House red wine £6.50</p>`,
      }));
      child.emit("close", 0);
    });
    return child;
  },
}));

describe("rendered price ledger", () => {
  it("keeps both glass quotes through serialization and ledger deduplication", async () => {
    await import("../scripts/harvest/uk-prices/render.mjs");
    const writes = vi.mocked(appendFileSync).mock.calls;
    expect(writes).toHaveLength(1);
    expect(defined(writes[0])[0]).toBe(path.join(process.cwd(), "data-harvest/uk_prices/rows.jsonl"));
    const rows = String(defined(writes[0])[1]).trim().split("\n").map((line) => JSON.parse(line));
    const deduped = dedupeSiteHarvestLedgerRows(rows, new Map());
    expect(deduped.filter((row) => row.drinkLabel === "Chardonnay, France")).toEqual([
      expect.objectContaining({ servingSize: "125ml", priceGbp: 5.5 }),
      expect.objectContaining({ servingSize: "250ml", priceGbp: 11 }),
    ]);
    const unknownSize = deduped.find((row) => row.drinkLabel === "House red wine");
    expect(unknownSize).toEqual(expect.objectContaining({ category: "wine", priceGbp: 6.5 }));
    expect(unknownSize).not.toHaveProperty("servingSize");
  });
});
