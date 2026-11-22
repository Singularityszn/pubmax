import { importFenceRule } from "./importFenceLint.mjs";

// A modelled price may reach only the surfaces that present it as an estimate.
// The Pint Index, the price bands, the cheapest-pint buckets and every
// current-price merge answer a price as a fact, so none of them may import the
// estimate engine. The anonymous price-confirm lane is retired: it counted a
// hashed IP, which cannot say how many people stood behind a price.

const SOURCE = "{app,components,lib,scripts}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
const MODULE_SUFFIX = "(?:\\.[cm]?[jt]sx?)?$";

const ESTIMATE_ENGINE_READERS = [
  "lib/priceEstimate.ts",
  "lib/priceEstimateBaselines.ts",
  "app/how-we-estimate/page.tsx",
  "scripts/build_price_estimate_baselines.mjs",
  // The UK bundle carries an estimate labelled as an estimate beside the
  // published rows, so a coverage answer can say what is modelled.
  "scripts/build_uk_price_bundle.mjs",
];

const RETIRED_CONFIRM_LANE = "The anonymous price-confirm lane is retired. A price correction is a new Pint Drop.";
const RETIRED_CONFIRM_FILE = /(?:^|\/)(?:app\/api\/price-confirm\/|lib\/priceConfirmStore\.)/;

const imports = importFenceRule([
  {
    pattern: new RegExp(`(?:^|/)priceEstimate(?:Baselines)?${MODULE_SUFFIX}`),
    allowedIn: ESTIMATE_ENGINE_READERS,
    message: "A modelled price may not reach a surface that answers a price as a fact. See lib/priceAuthorityLint.mjs.",
  },
  { pattern: new RegExp(`(?:^|/)priceConfirmStore${MODULE_SUFFIX}`), message: RETIRED_CONFIRM_LANE },
]);

const retiredConfirmLane = {
  meta: { type: "problem", schema: [], messages: { retired: RETIRED_CONFIRM_LANE } },
  create(context) {
    const check = (node, text) => {
      if (typeof text === "string" && text.includes("/api/price-confirm")) {
        context.report({ node, messageId: "retired" });
      }
    };
    return {
      Program: (node) => {
        if (RETIRED_CONFIRM_FILE.test(context.filename.split("\\").join("/"))) {
          context.report({ node, messageId: "retired" });
        }
      },
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.raw),
    };
  },
};

export const PRICE_AUTHORITY_FENCE_CONFIG = [
  {
    files: [SOURCE],
    // This module names the retired route in order to fence it.
    ignores: ["lib/priceAuthorityLint.mjs"],
    plugins: { "price-authority": { rules: { imports, "retired-confirm-lane": retiredConfirmLane } } },
    rules: {
      "price-authority/imports": "error",
      "price-authority/retired-confirm-lane": "error",
    },
  },
];
