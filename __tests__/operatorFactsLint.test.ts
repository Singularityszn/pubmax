import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
async function violations(file: string, code: string) {
  const results = await eslint.lintText(code, { filePath: path.resolve(file) });
  return results.flatMap((result) => result.messages.filter((message) => message.ruleId === "operator-facts/separation"));
}

describe("operator facts separation", () => {
  it("rejects imports from outside the approved surfaces", async () => {
    expect(await violations("lib/newRanker.ts", 'import { foo } from "@/lib/operatorFacts";')).not.toHaveLength(0);
    expect(await violations("lib/newRanker.ts", 'import("./operatorFactsStore")')).not.toHaveLength(0);
  });
  it("rejects operator fact names in ranking code", async () => {
    expect(await violations("lib/forYou.ts", "const operatorFact = 1;")).not.toHaveLength(0);
  });
  it("rejects sponsorship on the fact surfaces", async () => {
    expect(await violations("app/tonight/TonightFromThePubs.tsx", 'const label = "Sponsored";')).not.toHaveLength(0);
    expect(await violations("lib/operatorFacts.ts", 'import "@/lib/sponsorship";')).not.toHaveLength(0);
  });
  it("allows the approved block to import its fact types", async () => {
    expect(await violations("app/tonight/TonightFromThePubs.tsx", 'import type { TonightOperatorFact } from "@/lib/operatorFacts";')).toHaveLength(0);
  });
});
