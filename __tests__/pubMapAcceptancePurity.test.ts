import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "components", "PubMap.tsx"),
  "utf8",
);

describe("PubMap accepted-arrival purity", () => {
  it("resolves browser-backed acceptance state after render", () => {
    expect(source).not.toContain("function subscribeHydration");

    expect(source).toMatch(
      /const acceptedArrivalSnapshot = useCallback\([\s\S]*?\(\) => verifiedAcceptedArrivalSource\(\{/,
    );
    expect(source).toMatch(
      /const acceptedArrivalSource = useSyncExternalStore\([\s\S]*?subscribeAcceptedArrival[\s\S]*?acceptedArrivalSnapshot[\s\S]*?noAcceptedArrivalSource/,
    );
  });
});
