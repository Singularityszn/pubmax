import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
async function violations(code: string, file = "lib/newPriceConsumer.ts") {
  const results = await eslint.lintText(code, { filePath: path.resolve(file) });
  return results.flatMap((result) => result.messages.filter((message) => message.ruleId === "price-read/reviewed"));
}

describe("price read lint fence", () => {
  it.each([
    "rows.sort((a, b) => a.cheapestPrice - b.cheapestPrice)",
    'rows.map(({ ["cheapestPrice"]: price }) => price)',
    String.raw`rows.map(v => v.ch\u0065apestPrice)`,
  ])("rejects an unreviewed raw read: %s", async (body) => {
    expect(await violations(`export function rank(rows) { return ${body}; }`)).not.toHaveLength(0);
  });
  it("allows policy results without a raw read", async () => {
    expect(await violations("function rank(rows) { return rows.map(comparableVenuePint); }")).toHaveLength(0);
  });
  it("does not extend an existing allowance to a different function", async () => {
    expect(await violations("function rank(v) { return v.cheapestPrice; }", "lib/comparableVenuePint.ts")).not.toHaveLength(0);
  });
});
