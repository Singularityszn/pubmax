import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("ESLint repository scope", () => {
  it("ignores nested Claude worktrees, including detached worktrees", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });

    await expect(
      eslint.isPathIgnored(
        path.resolve(".claude/worktrees/detached/app/page.tsx"),
      ),
    ).resolves.toBe(true);
    await expect(
      eslint.isPathIgnored(
        path.resolve(".claude/worktrees/agent-123/components/Card.tsx"),
      ),
    ).resolves.toBe(true);
  });

  it("rejects a new source file above the line limit", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText(`${"// fake\n".repeat(801)}export {};\n`, { filePath: "lib/fakeLineLimit.ts" });
    expect(result?.messages.some((message) => message.ruleId === "max-lines" && message.severity === 2)).toBe(true);
  });

  it("allows an existing oversized file but rejects growth past its baseline", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const filePath = "app/u/[handle]/ProfilePageClient.tsx";
    const [existing] = await eslint.lintText(`${"// fake\n".repeat(801)}export {};\n`, { filePath });
    const [grown] = await eslint.lintText(`${"// fake\n".repeat(3000)}export {};\n`, { filePath });
    expect(existing?.messages.some((message) => message.ruleId === "max-lines")).toBe(false);
    expect(grown?.messages.some((message) => message.ruleId === "max-lines" && message.severity === 2)).toBe(true);
  });

  it("keeps equivalent main-tree application files in lint scope", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });

    await expect(eslint.isPathIgnored(path.resolve("app/page.tsx"))).resolves.toBe(
      false,
    );
    await expect(
      eslint.isPathIgnored(path.resolve("components/Card.tsx")),
    ).resolves.toBe(false);
  });
});
