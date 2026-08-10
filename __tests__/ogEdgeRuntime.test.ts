import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("edge OG route dependency boundary", () => {
  it("does not pull the node-only font loader into the edge bundle", () => {
    const route = readFileSync(join(root, "app/og.png/route.tsx"), "utf8");
    const edgeBrand = readFileSync(join(root, "lib/ogBrandEdge.tsx"), "utf8");

    expect(route).toContain('from "@/lib/ogBrandEdge"');
    expect(route).not.toContain('from "@/lib/ogBrand"');
    expect(edgeBrand).not.toMatch(/from ["'](?:node:)?(?:fs|path)["']/);
    expect(edgeBrand).not.toContain("process.cwd");
  });
});
