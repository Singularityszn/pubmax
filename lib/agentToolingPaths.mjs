// THE DIRECTORIES AGENT TOOLING WRITES INTO THIS CHECKOUT, WRITTEN DOWN ONCE.
//
// None of these hold app source. Every one of them is written by a tool a
// developer or an agent runs against this tree: a Claude worktree, a vendored
// skill pack, a scout bundle, an MCP server's index.
//
// THE COST OF TWO LISTS. `eslint.config.mjs` and knip each carried their own
// hand-written copy of this set, and the two already disagreed in five entries.
// `.gitnexus/` was in neither: it is written by the `gitnexus` MCP server this
// repo is wired to (`.gitnexusrc` is committed, `.gitignore` names the rule),
// it ships a CommonJS entry file full of `require()` calls, and eslint therefore failed
// `npm run lint` - and so `npm run verify` and the pre-push hook, the whole
// documented merge bar - on a CLEAN tree, for three errors in a file nobody
// here wrote and nobody can commit.
//
// THE RULE FOR ADDING ONE: the directory must be WRITTEN BY TOOLING rather than
// by this app. Being gitignored is not the test - `.agents/` and `skills/` are
// vendored packs this tree COMMITS, and they are still upstream sources rather
// than our code. A build output directory is not one of these either; those
// stay in each consumer's own list, because a build artifact is this tree's own
// output and the reason to skip it is a different reason.
//
// This is plain ESM with a `.d.mts` sidecar (the `lib/staticAssetPrefixes.mjs`
// idiom) because `eslint.config.mjs` and `knip.config.mjs` cannot import
// TypeScript and must read the same list.
// `__tests__/qualityGateWiring.test.ts` holds both consumers to it.
export const AGENT_TOOLING_PATHS = Object.freeze([
  // Claude stores complete (including detached) Git worktrees beneath the
  // checkout. They are independent branches, never source owned by this tree.
  ".claude/**",
  ".context/**",
  ".firecrawl/**",
  // Scout verification bundles contain vendored build output, not app source.
  ".scout/**",
  // Skill-pack reference assets and vendored agent/design packs - upstream
  // sources use require() and other idioms this tree's rules refuse.
  ".agents/**",
  "skills/**",
  // Ephemeral local debug captures.
  ".tmp-evidence/**",
  // The GitNexus code-graph index, rebuilt by `gitnexus analyze`.
  ".gitnexus/**",
]);
