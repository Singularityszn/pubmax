import { describe, expect, it, vi } from "vitest";

import { commitPubsSourceRevision } from "@/components/map/canvas/pubSourceRevision";

describe("commitPubsSourceRevision", () => {
  it("publishes key state only after the same cluster source revision settles", async () => {
    let settleSource: (() => void) | undefined;
    const sourceSettled = new Promise<void>((resolve) => {
      settleSource = resolve;
    });
    const order: string[] = [];
    const data: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };
    const source = {
      setData: vi.fn(() => {
        order.push("setData");
        return sourceSettled;
      }),
    };
    const publish = vi.fn(() => order.push("publish"));

    const committed = commitPubsSourceRevision({
      data,
      source,
      invalidatePaint: () => order.push("invalidate"),
      isCurrent: () => true,
      publish,
    });

    expect(order).toEqual(["invalidate", "setData"]);
    expect(source.setData).toHaveBeenCalledWith(data);
    expect(publish).not.toHaveBeenCalled();

    settleSource?.();
    await committed;

    expect(order).toEqual(["invalidate", "setData", "publish"]);
    expect(publish).toHaveBeenCalledWith(data);
  });

  it("does not publish a source revision superseded while its worker was settling", async () => {
    let settleSource: (() => void) | undefined;
    const sourceSettled = new Promise<void>((resolve) => {
      settleSource = resolve;
    });
    let current = true;
    const publish = vi.fn();

    const committed = commitPubsSourceRevision({
      data: { type: "FeatureCollection", features: [] },
      source: { setData: () => sourceSettled },
      invalidatePaint: () => {},
      isCurrent: () => current,
      publish,
    });
    current = false;
    settleSource?.();
    await committed;

    expect(publish).not.toHaveBeenCalled();
  });
});
