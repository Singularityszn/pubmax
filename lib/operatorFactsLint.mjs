import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const protectedModules = new Set([
  "lib/operatorFacts", "lib/operatorFactsStore", "lib/tonightOperatorFacts.server",
  "components/operators/VenueFromThePub", "app/tonight/TonightFromThePubs",
]);
const allowed = new Set([
  "lib/operatorFactsStore.ts", "lib/tonightOperatorFacts.server.ts", "lib/operatorProposalsStore.ts",
  "app/api/operator-proposals/route.ts", "app/api/operator-facts/route.ts",
  "components/operators/VenueFromThePub.tsx", "components/map/inspector/VenueOverviewTab.tsx",
  "app/tonight/TonightFromThePubs.tsx", "app/tonight/TonightClient.tsx", "app/tonight/page.tsx",
]);
const ranked = new Set([
  "lib/forYou.ts", "lib/concierge/rank.ts", "lib/nearMeAnswer.ts", "lib/priceTier.ts", "lib/priceBand.ts",
  "lib/pintTrust.ts", "lib/venues.ts", "lib/slimPins.ts", "lib/tonightListGrouping.ts",
  "lib/tonightOutListings.ts", "lib/tonightCheapPints.ts", "lib/hypedPubs.ts", "lib/dealsHonesty.ts",
]);
const surfaces = new Set(["components/operators/VenueFromThePub.tsx", "app/tonight/TonightFromThePubs.tsx", "lib/operatorFacts.ts"]);
const separation = {
  meta: { type: "problem", schema: [], messages: { separation: "Operator facts must remain separate from ranking and sponsorship." } },
  create(context) {
    const file = path.relative(root, context.filename).split(path.sep).join("/");
    const rank = ranked.has(file) || file.startsWith("components/map/canvas/");
    const surface = surfaces.has(file);
    function report(node) { context.report({ node, messageId: "separation" }); }
    function checkImport(node, source) {
      if (typeof source !== "string") return;
      const resolved = source.startsWith("@/") ? source.slice(2) : source.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), source)) : source;
      const withoutExtension = resolved.replace(/\.(?:[cm]?[jt]sx?)$/, "");
      if (protectedModules.has(withoutExtension) && !allowed.has(file)) report(node);
      if (surface && withoutExtension === "lib/sponsorship") report(node);
    }
    function checkText(node, value) {
      if (rank && /operatorFact|operator_facts|OperatorFact|FROM_THE_PUB/.test(value)) report(node);
      if (surface && /SPONSORED_DISCLOSURE_LABEL|\bSponsored\b/.test(value)) report(node);
    }
    return {
      ImportDeclaration(node) { checkImport(node, node.source.value); },
      ExportNamedDeclaration(node) { if (node.source) checkImport(node, node.source.value); },
      ExportAllDeclaration(node) { checkImport(node, node.source.value); },
      ImportExpression(node) { checkImport(node, node.source.value); },
      CallExpression(node) { if (node.callee.type === "Identifier" && node.callee.name === "require") checkImport(node, node.arguments[0]?.value); },
      Identifier(node) { checkText(node, node.name); },
      Literal(node) { if (typeof node.value === "string") checkText(node, node.value); },
      JSXText(node) { checkText(node, node.value); },
      TemplateElement(node) { checkText(node, node.value.cooked ?? ""); },
    };
  },
};
export const OPERATOR_FACTS_FENCE_CONFIG = [{
  files: ["{app,components,lib}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
  plugins: { "operator-facts": { rules: { separation } } },
  rules: { "operator-facts/separation": "error" },
}];
