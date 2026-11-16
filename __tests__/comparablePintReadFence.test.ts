import { describe, expect, it } from "vitest";
import { unreviewedPriceReads } from "./helpers/cheapestPriceReadFence";

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

  it("accepts a new consumer that compares policy results", () => {
    const source = 'import { comparableVenuePint } from "@/lib/comparableVenuePint"; export function rank(rows) { return rows.map(v => comparableVenuePint(v)).filter(p => p !== null).sort((a,b) => a-b); }';
    expect(unreviewedPriceReads(source, "new.ts")).toEqual([]);
  });

  it("limits each allowance to its reviewed function and read count", () => {
    const allowances = [{ owner: "display", count: 1, reason: "Prints an ordinary venue price without ranking." }];
    expect(unreviewedPriceReads("function display(v) { return v.cheapestPrice; } function rank(v) { return v.cheapestPrice; }", "new.ts", allowances)).toEqual([{ owner: "rank", count: 1 }]);
    expect(unreviewedPriceReads("function display(v) { return v.cheapestPrice + v.cheapestPrice; }", "new.ts", allowances)).toEqual([{ owner: "display", count: 2 }]);
  });

});
