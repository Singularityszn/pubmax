import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const button = readFileSync(join(process.cwd(), "components/ui/button.tsx"), "utf8");
const shadcn = JSON.parse(readFileSync(join(process.cwd(), "components.json"), "utf8")) as {
  tailwind: { css: string };
};

describe("owned UI foundation", () => {
  it("wires Tailwind v4 through the existing semantic token sheet", () => {
    expect(globals.trimStart()).toMatch(/^@import "tailwindcss";/);
    expect(shadcn.tailwind.css).toBe("app/globals.css");
  });

  it("keeps the shared button thumb-sized and token-driven", () => {
    expect(button).toContain("min-h-11");
    expect(button).toContain("var(--color-accent)");
    expect(button).toContain("motion-reduce:transition-none");
  });
});
