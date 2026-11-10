import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cheapestPriceReads, unreviewedPriceReads } from "./helpers/cheapestPriceReadFence";
import { PRICE_READ_ALLOWANCES } from "./helpers/cheapestPriceReadAllowances";

function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? modules(path) : /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(path) && !/\.d\.[cm]?ts$/.test(path) ? [path] : [];
  });
}

describe("A1 intentional raw price-read contract", () => {
  it.each([
    ["rows.sort((a, b) => a.cheapestPrice - b.cheapestPrice)", 2],
    ["rows.sort((a, b) => a?.cheapestPrice - b?.cheapestPrice)", 2],
    ['rows.sort((a, b) => a["cheapestPrice"] - b["cheapestPrice"])', 2],
    ["rows.map(({ cheapestPrice: price }) => price)", 1],
    ["rows.map(({ cheapestPrice }) => cheapestPrice)", 1],
    ['rows.map(({ ["cheapestPrice"]: price }) => price)', 1],
    ["rows.map(({ ['cheapestPrice']: price }) => price)", 1],
    [String.raw`rows.map(v => v.ch\u0065apestPrice)`, 1],
    [String.raw`rows.map(v => v["cheapest\x50rice"])`, 1],
  ])("requires review for a new raw consumer: %s", (body, count) => {
    expect(unreviewedPriceReads(`export function rank(rows) { return ${body}; }`, "new.ts")).toEqual([{ owner: "rank", count }]);
  });

  it("does not waive a raw sort because its module imports the policy", () => {
    const source = 'import { comparableVenuePint } from "@/lib/comparableVenuePint"; export function rank(rows) { return rows.sort((a,b) => a.cheapestPrice - b.cheapestPrice); }';
    expect(unreviewedPriceReads(source, "new.ts")).toEqual([{ owner: "rank", count: 2 }]);
  });

  it("scans runtime JSX, MTS and CTS files for new raw rankings", () => {
    const dir = mkdtempSync(join(tmpdir(), "pint-fence-"));
    try {
      for (const ext of ["jsx", "mts", "cts"]) {
        writeFileSync(join(dir, `ranking.${ext}`), "export function rank(rows) { return rows.sort((a,b) => a.cheapestPrice - b.cheapestPrice); }");
      }
      for (const ext of ["ts", "mts", "cts"]) writeFileSync(join(dir, `types.d.${ext}`), "export declare const cheapestPrice: number;");
      const paths = modules(dir).sort();
      expect(paths.map((path) => path.slice(dir.length + 1))).toEqual(["ranking.cts", "ranking.jsx", "ranking.mts"]);
      for (const path of paths) {
        expect(unreviewedPriceReads(readFileSync(path, "utf8"), path)).toEqual([{ owner: "rank", count: 2 }]);
        expect(unreviewedPriceReads('export function rank(rows) { return rows.map(v => comparablePint(v)).sort((a,b) => a-b); }', path)).toEqual([]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a new consumer that compares policy results", () => {
    const source = 'import { comparableVenuePint } from "@/lib/comparableVenuePint"; export function rank(rows) { return rows.map(v => comparableVenuePint(v)).filter(p => p !== null).sort((a,b) => a-b); }';
    expect(unreviewedPriceReads(source, "new.ts")).toEqual([]);
  });

  it("limits each allowance to its reviewed function and read count", () => {
    const allowances = [{ owner: "display", count: 1, reason: "Prints an ordinary venue price without ranking." }];
    expect(unreviewedPriceReads("function display(v) { return v.cheapestPrice; } function rank(v) { return v.cheapestPrice; }", "new.ts", allowances)).toEqual([{ owner: "rank", count: 1 }]);
    expect(unreviewedPriceReads("function display(v) { return v.cheapestPrice + v.cheapestPrice; }", "new.ts", allowances)).toEqual([{ owner: "display", count: 2 }]);
  });

  it("accounts for raw reads across runtime modules and builders", () => {
    const paths = ["lib", "components", "app", "scripts"].flatMap(modules);
    const offenders = paths.flatMap((path) =>
      unreviewedPriceReads(readFileSync(path, "utf8"), path, PRICE_READ_ALLOWANCES[path] ?? []).map((read) => ({ path, ...read })));
    const orphaned = Object.entries(PRICE_READ_ALLOWANCES).flatMap(([path, allowances]) => {
      const reads = paths.includes(path) ? cheapestPriceReads(readFileSync(path, "utf8"), path) : [];
      return allowances.filter((entry) => !reads.some((read) => read.owner === entry.owner)).map((entry) => ({ path, owner: entry.owner }));
    });
    expect(offenders).toEqual([]);
    expect(orphaned).toEqual([]);
  });
});
