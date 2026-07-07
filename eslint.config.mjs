import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".context/**",
      ".next/**",
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
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    // Code-quality signal, not a build gate. The worst function today has a
    // cyclomatic complexity of 31; the threshold sits above that and is a
    // "warn", so existing code stays green while new sprawl surfaces in review.
    // Ratchet the number DOWN over time as functions get refactored.
    rules: {
      complexity: ["warn", 35],
    },
  },
];

export default eslintConfig;
