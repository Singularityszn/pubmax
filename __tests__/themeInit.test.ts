import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { readThemeInitSource } from "@/lib/themeInit.server";

afterEach(() => vi.clearAllMocks());

describe("canonical inline theme initializer", () => {
  it("returns the exact public executable bytes", () => {
    const canonical = fs.readFileSync(join(process.cwd(), "public", "theme-init.js"), "utf8");
    expect(readThemeInitSource()).toBe(canonical);
  });

  it("preserves JavaScript operators and whitespace without JSON escaping", () => {
    const executable = "\nif (1 < 2 && 3 > 2) { window.ready = true; }\n";
    vi.mocked(fs.readFileSync).mockReturnValueOnce(executable);
    const source = readThemeInitSource();
    expect(source).toBe(executable);
    const window = { ready: false };
    new Function("window", source)(window);
    expect(window.ready).toBe(true);
  });

  it.each(["</script>", "</ScRiPt >", "<!--", "-->"])("refuses the raw-text delimiter %s", (delimiter) => {
    vi.mocked(fs.readFileSync).mockReturnValueOnce(`// ${delimiter}\nwindow.ready = true;`);
    expect(() => readThemeInitSource()).toThrow("unsafe HTML script delimiter");
  });

  it("fails closed when the canonical file cannot be read", () => {
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw new Error("missing canonical file"); });
    expect(() => readThemeInitSource()).toThrow("missing canonical file");
  });

  it("explicitly includes the canonical file in every server route trace", () => {
    const output = execFileSync(process.execPath, [
      "--input-type=module", "-e",
      "const { default: config } = await import('./next.config.mjs'); console.log(JSON.stringify(config.outputFileTracingIncludes));",
    ], { cwd: process.cwd(), encoding: "utf8" });
    const includes = JSON.parse(output) as Record<string, string[]>;
    // Next's global route glob covers root and nested dynamic documents.
    expect(includes["/*"]).toEqual(["./public/theme-init.js"]);
  });
});
