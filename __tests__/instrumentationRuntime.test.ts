import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const instrumentation = readFileSync(join(process.cwd(), "instrumentation.ts"), "utf8");
const nextConfig = readFileSync(join(process.cwd(), "next.config.mjs"), "utf8");

describe("server instrumentation runtime boundary", () => {
  it("does not expose Node-only Arize dependencies to the edge compiler", () => {
    expect(instrumentation).not.toMatch(
      /^import\s+\{\s*registerArizeTracing\s*\}\s+from\s+["']@\/lib\/observability\/arize["'];/m,
    );
    expect(instrumentation).toContain('process.env.NEXT_RUNTIME === "nodejs"');
    expect(instrumentation).toContain('await import("./instrumentation.node")');
    expect(nextConfig).toMatch(
      /serverExternalPackages:\s*\[[\s\S]*?["']@arizeai\/openinference-instrumentation-openai["']/,
    );
  });
});
