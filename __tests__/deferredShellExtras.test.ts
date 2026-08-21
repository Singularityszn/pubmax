import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "components/DeferredShellExtras.tsx"),
  "utf8",
);

describe("deferred shell extras", () => {
  it("does not fetch hidden shell features during the current route load", () => {
    expect(source).toContain("DEFERRED_SHELL_FALLBACK_MS = 30_000");
    expect(source).toContain("if (!ready) return <CellarNotice />");
    expect(source).not.toContain('window.addEventListener("pointerdown"');
  });
});
