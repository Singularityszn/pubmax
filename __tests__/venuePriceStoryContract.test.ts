import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/map/VenuePriceStory.tsx"), "utf8");

describe("VenuePriceStory async story contract", () => {
  it("clears prior reads and ignores responses from cancelled requests", () => {
    expect(source).toContain("return readState?.key === requestKey ? readState.value : null;");
    expect(source).toContain("if (cancelled) return;");
  });

  it("refreshes the read after a successful price confirmation", () => {
    expect(source).toContain("onConfirmed?: () => void");
    expect(source).toContain("onConfirmed?.();");
  });
});
