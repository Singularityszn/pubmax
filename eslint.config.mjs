import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".context/**",
      ".next/**",
      ".next-e2e/**",
      ".next-prod/**",
      ".vercel/**",
      "node_modules/**",
      "coverage/**",
      "public/data/**",
      "data/**",
      // Generated verification artifacts — never hand-authored source.
      "test-results/**",
      "playwright-report/**",
      // Local co-dev scratch probes (also gitignored); not part of the app.
      "scratch-*.mjs",
      // Vendored agent skills — not app runtime; keep lint signal on product code.
      "skills/**",
      ".firecrawl/**",
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
