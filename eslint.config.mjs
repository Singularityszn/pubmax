import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [".context/**", ".next/**", "node_modules/**", "public/data/**", "data/**"],
  },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
