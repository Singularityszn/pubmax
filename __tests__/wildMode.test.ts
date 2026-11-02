// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWildMode } from "@/lib/useWildMode";
import {
  WILD_MODE_STORAGE_KEY,
  adoptWildModeFromAddress,
  adoptWildModeParam,
  readWildMode,
  searchWithoutWildModeParam,
  subscribeWildMode,
  writeWildMode,
} from "@/lib/wildMode";

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

function address(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

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

describe("the switch's param on the address", () => {
  it("is taken out, and every other piece of the query is kept as written", () => {
    expect(searchWithoutWildModeParam("?wild=1")).toBe("");
    expect(searchWithoutWildModeParam("?sel=venue-1&wild=1")).toBe("?sel=venue-1");
    expect(searchWithoutWildModeParam("wild=0&q=a%20b+c&z=%7E")).toBe("?q=a%20b+c&z=%7E");
    expect(searchWithoutWildModeParam("?wild=1&wild=0&tab=prices")).toBe("?tab=prices");
    expect(searchWithoutWildModeParam("?w%69ld=on&tab=prices")).toBe("?tab=prices");
    expect(searchWithoutWildModeParam("?wilder=1&mild=1")).toBeNull();
    expect(searchWithoutWildModeParam("?sel=venue-1")).toBeNull();
    expect(searchWithoutWildModeParam("")).toBeNull();
  });

  it("comes off the address once read, keeping the path, the other params and the hash", () => {
    window.history.replaceState({ kept: true }, "", "/pubs/the-lamb?sel=venue-1&wild=1&tab=prices#hours");
    const length = window.history.length;
    expect(adoptWildModeFromAddress()).toBe(true);
    expect(readWildMode()).toBe(true);
    expect(address()).toBe("/pubs/the-lamb?sel=venue-1&tab=prices#hours");
    // Replaced in place: no new history entry, and the entry's state kept.
    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual({ kept: true });
  });

  it("comes off the address when it turns the switch off, too", () => {
    writeWildMode(true);
    window.history.replaceState(null, "", "/map?wild=0");
    expect(adoptWildModeFromAddress()).toBe(false);
    expect(readWildMode()).toBe(false);
    expect(address()).toBe("/map");
  });

  it("leaves an address that does not mention it alone", () => {
    window.history.replaceState(null, "", "/crawls?sort=cheap#top");
    const replace = vi.spyOn(window.history, "replaceState");
    expect(adoptWildModeFromAddress()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    replace.mockRestore();
    expect(address()).toBe("/crawls?sort=cheap#top");
  });

  it("is read and removed by the hook on mount, so a copied link cannot carry it", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState(null, "", "/routes/victorian-soho?wild=1#receipt");
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useWildMode());
      return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(true);
    expect(window.location.href).toBe(`${window.location.origin}/routes/victorian-soho#receipt`);
    act(() => root.unmount());
  });
});
