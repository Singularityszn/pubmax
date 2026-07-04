import { describe, expect, it } from "vitest";

import { validatePhoto } from "@/lib/pintDropsStore";

// Pure validation only — no live Supabase. These run in the same node env as
// the rest of the suite (no keys required).
describe("validatePhoto", () => {
  it("accepts a valid jpeg under the size cap", () => {
    expect(validatePhoto("image/jpeg", 2 * 1024 * 1024)).toBeNull();
  });

  it("accepts png and webp", () => {
    expect(validatePhoto("image/png", 1000)).toBeNull();
    expect(validatePhoto("image/webp", 1000)).toBeNull();
  });

  it("rejects a non-image type", () => {
    expect(validatePhoto("application/pdf", 1000)).toMatch(/JPEG, PNG, or WebP/);
  });

  it("rejects a file over 5MB", () => {
    expect(validatePhoto("image/jpeg", 5 * 1024 * 1024 + 1)).toMatch(/5MB/);
  });
});
