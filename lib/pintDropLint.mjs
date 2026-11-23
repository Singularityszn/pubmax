import { importFenceRule } from "./importFenceLint.mjs";

// Two shapes of the Pint Drop lane. The trust story is read once, in
// lib/pintTrust.ts, so the sheet, the peek and the pin cannot disagree about
// one pub. And the table is named once, in lib/pintDropTable.ts: since 0118
// `visit_reports` is only a compatibility view over `pint_drops`.

const RUNTIME = "{app,components,lib}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
const TABLE_OWNER = "lib/pintDropTable.ts";

const imports = importFenceRule([
  {
    pattern: /(?:^|\/)(?:venues|pintDropConfirmation)(?:\.ts)?$/,
    importNames: ["authoritativePriceDrop", "confirmedPriceInputFor", "provisionalPriceDrop", "agedPriceDrop"],
    allowedIn: ["lib/pintTrust.ts"],
    message: "Read the drop lane once, through pintTrustFor (lib/pintTrust.ts), never one lane of it.",
  },
]);

const TABLE_NAMES = new Set(["pint_drops", "visit_reports"]);

const tableName = {
  meta: {
    type: "problem",
    schema: [],
    messages: { table: "Name the Pint Drop table with PINT_DROPS_TABLE from lib/pintDropTable.ts." },
  },
  create(context) {
    const check = (node, value) => {
      if (TABLE_NAMES.has(value)) context.report({ node, messageId: "table" });
    };
    return {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked),
    };
  },
};

export const PINT_DROP_FENCE_CONFIG = [
  {
    files: [RUNTIME],
    plugins: { "pint-drop": { rules: { imports, "table-name": tableName } } },
    rules: { "pint-drop/imports": "error" },
  },
  {
    files: [RUNTIME],
    // The status-writer fence maps the shared constant back to its table name,
    // and this module names both tables in order to fence them.
    ignores: [TABLE_OWNER, "lib/statusWriterFence.mjs", "lib/pintDropLint.mjs"],
    rules: { "pint-drop/table-name": "error" },
  },
];
