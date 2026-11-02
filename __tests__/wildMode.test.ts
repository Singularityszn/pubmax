// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WILD_MODE_STORAGE_KEY,
  adoptWildModeParam,
  readWildMode,
  subscribeWildMode,
  writeWildMode,
} from "@/lib/wildMode";

afterEach(() => {
  window.localStorage.clear();
});

describe("the wild switch", () => {
  it("is off until a reader turns it on", () => {
    expect(readWildMode()).toBe(false);
  });

  it("turns on and off from the address, and remembers", () => {
    expect(adoptWildModeParam("?wild=1")).toBe(true);
    expect(readWildMode()).toBe(true);
    expect(window.localStorage.getItem(WILD_MODE_STORAGE_KEY)).toBe("1");
    expect(adoptWildModeParam("?wild=0")).toBe(false);
    expect(readWildMode()).toBe(false);
    expect(window.localStorage.getItem(WILD_MODE_STORAGE_KEY)).toBeNull();
  });

  it("ignores an address that does not mention it", () => {
    writeWildMode(true);
    expect(adoptWildModeParam("?sel=venue-1")).toBeNull();
    expect(readWildMode()).toBe(true);
  });

  it("tells subscribers when it changes", () => {
    const onChange = vi.fn();
    const stop = subscribeWildMode(onChange);
    writeWildMode(true);
    writeWildMode(false);
    stop();
    writeWildMode(true);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("answers off when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readWildMode()).toBe(false);
    spy.mockRestore();
  });
});
