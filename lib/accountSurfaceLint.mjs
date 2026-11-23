import { importFenceRule } from "./importFenceLint.mjs";

// Setting a password and editing private details are signed-in acts. Their
// forms live in one place, the account hub, so the sign-in page and any page a
// visitor can reach without a session can never mount them. The password
// policy is one pure table that the browser form and the sign-in route both
// read, so it may not take a server or browser dependency.

const SOURCE = "{app,components,lib,scripts}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
const ACCOUNT_HUB = "components/profile/PubmaxxAccountHub.tsx";
const PASSWORD_POLICY = "lib/passwordPolicy.ts";

const imports = importFenceRule([
  {
    pattern: /(?:^|\/)(?:SetAccountPassword|PrivateIdentityEditor)(?:\.tsx?)?$/,
    allowedIn: [ACCOUNT_HUB],
    message: "The password and private-details forms mount only in the signed-in account hub.",
  },
  {
    pattern: /^(?:@\/lib\/supabase|next\/(?:headers|navigation)$|server-only$|client-only$)/,
    onlyIn: [PASSWORD_POLICY],
    message: "lib/passwordPolicy.ts stays pure, so the browser and the sign-in route read the same rules.",
  },
]);

const noDirective = {
  meta: {
    type: "problem",
    schema: [],
    messages: { directive: "lib/passwordPolicy.ts stays pure: no \"{{directive}}\" directive." },
  },
  create(context) {
    return {
      Program(node) {
        for (const statement of node.body) {
          if (statement.type !== "ExpressionStatement" || typeof statement.directive !== "string") break;
          context.report({ node: statement, messageId: "directive", data: { directive: statement.directive } });
        }
      },
    };
  },
};

export const ACCOUNT_SURFACE_FENCE_CONFIG = [
  {
    files: [SOURCE],
    plugins: { "account-surface": { rules: { imports, "pure-module": noDirective } } },
    rules: { "account-surface/imports": "error" },
  },
  {
    files: [PASSWORD_POLICY],
    rules: { "account-surface/pure-module": "error" },
  },
];
