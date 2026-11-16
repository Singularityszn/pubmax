import path from "node:path";
import { fileURLToPath } from "node:url";
import { cheapestPriceReads } from "../__tests__/helpers/cheapestPriceReadFence.ts";
import { PRICE_READ_ALLOWANCES } from "../__tests__/helpers/cheapestPriceReadAllowances.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
export const priceReadAllowanceFiles = Object.keys(PRICE_READ_ALLOWANCES);
const reviewed = {
  meta: { type: "problem", schema: [], messages: {
    unreviewed: "Raw cheapestPrice reads in {{owner}} need price-policy review ({{count}} reads).",
    orphaned: "Remove the stale cheapestPrice allowance for {{owner}}.",
  } },
  create(context) {
    return { Program(node) {
      const file = path.relative(root, context.filename).split(path.sep).join("/");
      const allowances = PRICE_READ_ALLOWANCES[file] ?? [];
      const reads = cheapestPriceReads(context.sourceCode.text, file);
      for (const read of reads) {
        if (!allowances.some((entry) => entry.owner === read.owner && entry.count === read.count && entry.reason.trim())) {
          context.report({ node, messageId: "unreviewed", data: { owner: read.owner, count: read.count } });
        }
      }
      for (const entry of allowances) {
        if (!reads.some((read) => read.owner === entry.owner)) context.report({ node, messageId: "orphaned", data: { owner: entry.owner } });
      }
    } };
  },
};
export const PRICE_READ_FENCE_CONFIG = [{
  files: ["{app,components,lib,scripts}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
  ignores: ["**/*.d.{ts,mts,cts}"],
  plugins: { "price-read": { rules: { reviewed } } },
  rules: { "price-read/reviewed": "error" },
}];
