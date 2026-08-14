import { describe, expect, it } from "vitest";

import { resolveNearAutoLocate } from "@/components/nearme/NearPageClient";

describe("Near explicit location entry", () => {
  it("auto-locates only for exact locate=1 intent", () => {
    expect(resolveNearAutoLocate(new URLSearchParams("locate=1"))).toBe(true);
    expect(resolveNearAutoLocate(new URLSearchParams("locate=0"))).toBe(false);
    expect(resolveNearAutoLocate(new URLSearchParams("locate=true"))).toBe(false);
    expect(resolveNearAutoLocate(new URLSearchParams())).toBe(false);
  });
});
