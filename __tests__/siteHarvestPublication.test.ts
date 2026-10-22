import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const directories: string[] = [];
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const quote = {
  venueId: "venue-uk-n1", host: "thealbionpub.com", category: "gin",
  drinkLabel: "GORDONS", servingSize: "25ml", priceGbp: 4,
  sourceUrl: "https://www.thealbionpub.com/uploads/drink.pdf?v=1772220206",
  observedAt: "2026-09-21T00:00:00.000Z",
};
const newer = { ...quote, priceGbp: 7, observedAt: "2026-10-01T14:16:36.325Z" };
const otherServing = { ...newer, servingSize: "50ml", priceGbp: 12 };
const unknownServing = { ...newer, servingSize: undefined, priceGbp: 6 };

function fixture(rows: unknown[], extraText = "") {
  const root = mkdtempSync(join(tmpdir(), "pubmax-ledger-publish-"));
  directories.push(root);
  mkdirSync(join(root, "data/osm/uk"), { recursive: true });
  mkdirSync(join(root, "data/uk_prices"), { recursive: true });
  writeFileSync(join(root, "data/osm/uk/uk_osm_pubs.json"), "[]\n");
  const raw = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n${extraText}`;
  const historical = `${JSON.stringify(rows[0])}\n`;
  const firstRow = JSON.parse(JSON.stringify(rows[0])) as Record<string, unknown>;
  const canonicalFirstRow = Object.fromEntries(
    Object.entries(firstRow).sort(([left], [right]) => left.localeCompare(right)),
  );
  const firstRowIdentity = sha256(JSON.stringify(canonicalFirstRow));
  const history = {
    schemaVersion: 2,
    publishedLedger: { rowCount: 1, sha256: "historic-withdrawal-receipt" },
    postReconciliationPublication: {
      sourceCaptureSha256: "historic-capture", sourceObservedAt: quote.observedAt,
      sourceUrl: quote.sourceUrl, supersededRowSha256: "historic-superseded-row",
      currentLedger: { rowCount: 1, sha256: sha256(historical), rowIdentitySetSha256: sha256(`${firstRowIdentity}\n`) },
      currentBundle: { rowCount: 1, siteHarvestRows: 1 },
    },
    accounting: { unexplainedLosses: 0, withdrawnRows: 19 },
    knownMisclassifiedWithdrawals: [{ disposition: "withdraw", reason: "Existing audit remains unchanged" }],
  };
  writeFileSync(join(root, "data/uk_prices/site_harvest.jsonl"), raw);
  writeFileSync(join(root, "data/uk_prices/site_harvest_reconciliation.json"), `${JSON.stringify(history, null, 2)}\n`);
  return { root, raw, history, historical };
}

function build(root: string, dryRun = false) {
  return execFileSync(process.execPath, [
    join(ROOT, "node_modules/tsx/dist/cli.mjs"), "--tsconfig", join(ROOT, "tsconfig.json"),
    join(ROOT, "scripts/build_uk_price_bundle.mjs"), ...(dryRun ? ["--dry-run"] : []),
  ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function report(root: string) {
  return JSON.parse(readFileSync(join(root, "data/uk_prices/site_harvest_reconciliation.json"), "utf8"));
}

afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("official offline site-harvest publication", () => {
  it("previews canonical counts and complete raw archive binding without writing", () => {
    const input = fixture([quote, newer, otherServing, unknownServing]);
    const manifest = JSON.parse(build(input.root, true));
    expect(manifest.siteHarvestPublication.sourceLedger).toMatchObject({ rowCount: 4, sha256: sha256(input.raw) });
    expect(manifest.siteHarvestPublication.currentLedger.rowCount).toBe(3);
    expect(manifest.siteHarvestPublication.accounting).toEqual({ sourceRows: 4, canonicalRows: 3, supersededRows: 1, unexplainedLosses: 0 });
    expect(readFileSync(join(input.root, "data/uk_prices/site_harvest.jsonl"), "utf8")).toBe(input.raw);
    expect(report(input.root)).toEqual(input.history);
    expect(existsSync(join(input.root, "data/uk_prices/observations"))).toBe(false);
    expect(existsSync(join(input.root, "public/data/uk_prices/rows.json"))).toBe(false);
  });

  it("publishes newest quotes, preserves serving distinctions and archives every original byte", () => {
    const input = fixture([quote, newer, otherServing, unknownServing]);
    build(input.root);
    const text = readFileSync(join(input.root, "data/uk_prices/site_harvest.jsonl"), "utf8");
    const rows = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([newer, otherServing, JSON.parse(JSON.stringify(unknownServing))]));
    const publication = report(input.root).currentPublication;
    expect(readFileSync(join(input.root, publication.sourceLedger.path), "utf8")).toBe(input.raw);
    expect(publication.currentLedger).toMatchObject({ rowCount: 3, sha256: sha256(text) });
    expect(publication.supersededRows).toHaveLength(1);
    expect(publication.supersededRows[0]).toMatchObject({ beforeObservedAt: quote.observedAt, currentObservedAt: newer.observedAt });
    const historicalFields = { ...report(input.root) };
    delete historicalFields.currentPublication;
    delete historicalFields.publicationHistory;
    expect(historicalFields).toEqual(input.history);
    expect(readFileSync(join(input.root, publication.historicalLedgers[0].path), "utf8")).toBe(input.historical);
    const bundle = JSON.parse(readFileSync(join(input.root, "public/data/uk_prices/rows.json"), "utf8"));
    expect(bundle).toHaveLength(3);
    expect(bundle.map((row: { priceGbp: number }) => row.priceGbp).sort((a: number, b: number) => a - b)).toEqual([6, 7, 12]);
    expect(publication.currentBundle).toMatchObject({ rowCount: 3, siteHarvestRows: 3 });
  });

  it("keeps original raw evidence and historical receipts across a no-change rebuild", () => {
    const input = fixture([quote, newer, otherServing]);
    build(input.root);
    const first = report(input.root);
    const firstLedger = readFileSync(join(input.root, "data/uk_prices/site_harvest.jsonl"), "utf8");
    build(input.root);
    const second = report(input.root);
    expect(second.currentPublication.sourceLedger).toEqual(first.currentPublication.sourceLedger);
    expect(second.currentPublication.supersededRows).toEqual(first.currentPublication.supersededRows);
    expect(second.currentPublication.historicalLedgers).toEqual(first.currentPublication.historicalLedgers);
    expect(second.publicationHistory ?? []).toEqual(first.publicationHistory ?? []);
    expect(readFileSync(join(input.root, second.currentPublication.sourceLedger.path), "utf8")).toBe(input.raw);
    expect(readFileSync(join(input.root, "data/uk_prices/site_harvest.jsonl"), "utf8")).toBe(firstLedger);
  });

  it("refuses malformed observations before rewriting ledger, archive or publication", () => {
    const input = fixture([quote], "{not-json}\n");
    const beforeReport = readFileSync(join(input.root, "data/uk_prices/site_harvest_reconciliation.json"), "utf8");
    expect(() => build(input.root)).toThrow();
    expect(readFileSync(join(input.root, "data/uk_prices/site_harvest.jsonl"), "utf8")).toBe(input.raw);
    expect(readFileSync(join(input.root, "data/uk_prices/site_harvest_reconciliation.json"), "utf8")).toBe(beforeReport);
    expect(existsSync(join(input.root, "data/uk_prices/observations"))).toBe(false);
    expect(existsSync(join(input.root, "public/data/uk_prices/rows.json"))).toBe(false);
  });


  it("preserves retained legacy label evidence and its existing exact category quarantine", () => {
    const legacy = { ...quote, category: "wine", priceGbp: 4,
      sourceUrl: "https://thebellonthegreen.com/drinks/", host: "thebellonthegreen.com",
      drinkLabel: "London Pride 500ml", servingSize: undefined,
    };
    const input = fixture([legacy]);
    build(input.root);
    const rows = readFileSync(join(input.root, "data/uk_prices/site_harvest.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(rows).toEqual([JSON.parse(JSON.stringify(legacy))]);
    expect(JSON.parse(readFileSync(join(input.root, "public/data/uk_prices/rows.json"), "utf8"))).toEqual([]);
    expect(readFileSync(join(input.root, report(input.root).currentPublication.sourceLedger.path), "utf8")).toBe(input.raw);
  });


  it("retires an older same-key quote before quarantining its newer contradiction, preserving named spirit quotes", () => {
    const oldVodka = { ...quote, category: "vodka", drinkLabel: undefined, servingSize: undefined };
    const wrongNewVodka = { ...oldVodka, priceGbp: 9.5, observedAt: newer.observedAt };
    const greyGoose = { ...newer, category: "vodka", drinkLabel: "GREY GOOSE", priceGbp: 9.5 };
    const gordons = { ...newer, priceGbp: 4 };
    const input = fixture([oldVodka, wrongNewVodka, greyGoose, gordons]);
    build(input.root);
    const bundle = JSON.parse(readFileSync(join(input.root, "public/data/uk_prices/rows.json"), "utf8"));
    expect(bundle.filter((row: { category: string; drinkLabel?: string }) => row.category === "vodka" && !row.drinkLabel)).toEqual([]);
    expect(bundle).toHaveLength(2);
    expect(bundle).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "vodka", drinkLabel: "GREY GOOSE", priceGbp: 9.5, servingSize: "25ml", observedAt: newer.observedAt }),
      expect.objectContaining({ category: "gin", drinkLabel: "GORDONS", priceGbp: 4, servingSize: "25ml", observedAt: newer.observedAt }),
    ]));
    const publication = report(input.root).currentPublication;
    expect(publication.accounting).toEqual({ sourceRows: 4, canonicalRows: 3, supersededRows: 1, unexplainedLosses: 0 });
    expect(readFileSync(join(input.root, publication.sourceLedger.path), "utf8")).toBe(input.raw);
  });

  it("keeps source-permission exclusions in the existing bundle producer", () => {
    const input = fixture([quote, { ...quote, venueId: "venue-uk-n2", sourceUrl: "https://www.nicholsonspubs.co.uk/menu", host: "nicholsonspubs.co.uk" }]);
    const manifest = JSON.parse(build(input.root, true));
    expect(manifest.counts.byLane["site-harvest"]).toBe(1);
    expect(manifest.notes.join(" ")).toContain("1 on a host refused on permission");
    expect(existsSync(join(input.root, "public/data/uk_prices/rows.json"))).toBe(false);
  });
});
