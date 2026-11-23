// A deal row says what is on and when it ends. It cannot prove that anybody
// saved money, so no deal surface may count or claim a saving.

const DEAL_SURFACES = [
  "lib/dealsHonesty.ts",
  "lib/dealsHonestyCore.ts",
  "components/discovery/DealsTonightLane.tsx",
  "components/map/TonightLane.tsx",
  "app/tonight/TonightOnTonightSummary.tsx",
];

const SAVING_CLAIM = /money ?saved|you(?:'|’)?(?:ve)? saved|saved ?total|total ?saved|savings ?total|saved so far/i;

/** "savedTotal" and "saved_total" read as "saved total". */
const words = (text) => text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");

const noSavingClaim = {
  meta: {
    type: "problem",
    schema: [],
    messages: { saving: "A deal row cannot prove a saving. Say what is on and when it ends." },
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text === "string" && SAVING_CLAIM.test(words(text))) context.report({ node, messageId: "saving" });
    };
    return {
      Identifier: (node) => check(node, node.name),
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.cooked),
      JSXText: (node) => check(node, node.value),
    };
  },
};

export const DEAL_HONESTY_FENCE_CONFIG = [
  {
    files: DEAL_SURFACES,
    plugins: { "deal-honesty": { rules: { "no-saving-claim": noSavingClaim } } },
    rules: { "deal-honesty/no-saving-claim": "error" },
  },
];

/** Every repository path this module names, for eslint.config.mjs to check. */
export const dealSurfaceFiles = DEAL_SURFACES;
