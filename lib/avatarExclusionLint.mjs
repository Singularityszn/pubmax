import { importFenceRule } from "./importFenceLint.mjs";

// Served avatars show wherever a handle shows, except on the surfaces that
// redact or never knew one: the family table ledger, free-text crew names in
// a crawl, the public plan invite and the night-story public view. Those
// surfaces may not reach a served avatar by any route.

const NO_AVATAR_SURFACES = [
  "app/ledger/[id]/page.tsx",
  "components/plan/NightCrawlMode.tsx",
  "app/invite/[token]/page.tsx",
  "components/plan/InvitePageView.tsx",
  "lib/nightMemoryStore.ts",
  "components/profile/NightMemoryStudio.tsx",
];

const MESSAGE = "This surface stays avatar-free. See lib/avatarExclusionLint.mjs.";

const imports = importFenceRule([
  { pattern: /(?:^|\/)(?:HandleAvatar|avatarResolve)(?:\.tsx?)?$/, onlyIn: NO_AVATAR_SURFACES, message: MESSAGE },
]);

const noServedAvatar = {
  meta: { type: "problem", schema: [], messages: { avatar: MESSAGE } },
  create(context) {
    const checkText = (node, text) => {
      if (typeof text === "string" && text.includes("/api/avatar/")) context.report({ node, messageId: "avatar" });
    };
    return {
      Identifier: (node) => {
        if (node.name === "avatarUrl") context.report({ node, messageId: "avatar" });
      },
      JSXIdentifier: (node) => {
        if (node.name === "avatarUrl") context.report({ node, messageId: "avatar" });
      },
      Literal: (node) => checkText(node, node.value),
      TemplateElement: (node) => checkText(node, node.value.cooked),
    };
  },
};

export const AVATAR_EXCLUSION_FENCE_CONFIG = [
  {
    // `[id]` and `[token]` are route folders, not glob classes.
    files: NO_AVATAR_SURFACES.map((file) => file.replace(/[[\]]/g, "\\$&")),
    plugins: { "avatar-exclusion": { rules: { imports, "no-served-avatar": noServedAvatar } } },
    rules: {
      "avatar-exclusion/imports": "error",
      "avatar-exclusion/no-served-avatar": "error",
    },
  },
];

/** Every repository path this module names, for eslint.config.mjs to check. */
export const avatarExclusionFiles = NO_AVATAR_SURFACES;
