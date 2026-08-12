import { describe, expect, it } from "vitest";

// @ts-expect-error -- next.config.mjs has no declaration file.
import nextConfigModule from "@/next.config.mjs";

describe("Next deployment skew configuration", () => {
  it("declares a deployment marker for local and prebuilt builds", () => {
    expect(nextConfigModule.deploymentId).toBeTruthy();
  });
});
