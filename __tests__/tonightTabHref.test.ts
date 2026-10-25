import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { primaryNavKeyForPath } from "@/components/nav/navigationModel";
import { useNowHref } from "@/lib/useNowHref";

function MainTab() {
  return createElement("a", { href: useNowHref() }, "Tonight");
}

afterEach(() => vi.useRealTimers());

describe("the Tonight tab's static document fallback", () => {
  it.each([
    "2026-01-15T11:00:00Z",
    "2026-01-15T16:00:00Z",
    "2026-08-16T14:59:59Z",
    "2026-08-16T15:00:00Z",
    "2026-08-16T22:59:00Z",
  ])("keeps cached server markup stable at %s", (instant) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    expect(renderToString(createElement(MainTab))).toBe('<a href="/tonight">Tonight</a>');
  });

  it("lights the same tab on both explicit page destinations", () => {
    expect(primaryNavKeyForPath("/today")).toBe("now");
    expect(primaryNavKeyForPath("/today/highlights")).toBe("now");
    expect(primaryNavKeyForPath("/tonight")).toBe("now");
  });
});
