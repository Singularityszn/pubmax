// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useFirstListingsRead } from "@/app/tonight/useFirstListingsRead";
import type { TonightListingsStatus } from "@/lib/tonightOutListings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ status }: { status: TonightListingsStatus }) {
  return createElement("output", null, String(useFirstListingsRead(status)));
}

describe("useFirstListingsRead", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function walk(statuses: readonly TonightListingsStatus[]): string[] {
    return statuses.map((status) => {
      act(() => root.render(createElement(Probe, { status })));
      return host.textContent ?? "";
    });
  }

  it("holds while the first read runs and releases on its answer", () => {
    expect(walk(["idle", "idle", "ready"])).toEqual(["true", "true", "false"]);
  });

  it("does not hold again when a retry puts the listings back to idle", () => {
    expect(walk(["idle", "error", "idle", "empty", "idle"])).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
    ]);
  });
});
