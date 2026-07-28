import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      // Claude stores complete (including detached) Git worktrees beneath the
      // checkout. They are independent branches, never source owned by this
      // tree, and must not be allowed to fail this tree's lint gate.
      ".claude/worktrees/",
      ".context/**",
      ".firecrawl/**",
      // Scout verification bundles contain vendored build output, not app source.
      ".scout/**",
      ".next/**",
      ".next-*/**",
      ".vercel/**",
      "node_modules/**",
      "coverage/**",
      "public/data/**",
      "data/**",
      // Vendored agent/design skill packs — not app source; upstream uses require() etc.
      "skills/**",
      // Generated verification artifacts — never hand-authored source.
      "test-results/**",
      "playwright-report/**",
      // Local co-dev scratch probes (also gitignored); not part of the app.
      "scratch-*.mjs",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    // Code-quality signal, not a build gate. The worst functions today sit
    // around cyclomatic complexity 40-41; the threshold is still only a
    // "warn", so existing code stays green while new sprawl surfaces in review.
    // Ratchet the number DOWN over time as functions get refactored.
    rules: {
      complexity: ["warn", 35],
    },
  },
];

export default eslintConfig;
