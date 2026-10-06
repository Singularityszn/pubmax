import { describe, expect, it } from "vitest";

import { citationSourceLabel } from "@/lib/citationSourceLabel";
import { MAGIC_LINK_SENT_MESSAGE } from "@/lib/passwordlessAuth";

// Signed-in QA F27: copy that named the wrong screen or leaked an internal word.
describe("signed-in copy", () => {
  it("does not call a sign-up link a sign-in link", () => {
    expect(MAGIC_LINK_SENT_MESSAGE).not.toContain("sign-in link");
    expect(MAGIC_LINK_SENT_MESSAGE).toContain("it is on its way");
  });

  it("never prints the internal word seed on a source chip", () => {
    expect(citationSourceLabel("seed")).toBe("Demo");
    expect(citationSourceLabel(" Seed ")).toBe("Demo");
    expect(citationSourceLabel("Wikipedia")).toBe("Wikipedia");
  });
});

describe("the busy report thanks line", () => {
  it("is hidden from assistive tech once its live region carries the same line", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), "components/map/VenueOccupancyRow.tsx"), "utf8");
    expect(source).toContain("aria-hidden={receiptLine ? true : undefined}");
  });
});
