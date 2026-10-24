import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("Application Zod collection limits (GHSA-mrhx-c7xc-m3w5)", () => {
  // The upstream fix rejects oversized collections before validating elements.
  // Three values exercise that contract without a resource-exhaustion payload.
  it.each(["array max", "array length", "set max", "set size"] as const)(
    "rejects an oversized %s before validating its elements",
    (bound) => {
      let parsed = 0;
      const element = z.string().refine(() => {
        parsed++;
        return true;
      });
      const values = ["a", "b", "c"];
      const schemas = {
        "array max": () => z.array(element).max(2).safeParse(values),
        "array length": () => z.array(element).length(2).safeParse(values),
        "set max": () => z.set(element).max(2).safeParse(new Set(values)),
        "set size": () => z.set(element).size(2).safeParse(new Set(values)),
      };
      const result = schemas[bound]();
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([expect.objectContaining({ code: "too_big", path: [] })]);
      expect(parsed).toBe(0);
    },
  );

  it("still validates permitted collections and rejects invalid elements", () => {
    const schemas = [
      [z.array(z.string()).max(2), ["a", "b"], [1]],
      [z.set(z.string()).max(2), new Set(["a", "b"]), new Set([1])],
    ] as const;
    for (const [schema, valid, invalid] of schemas) {
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });
});
