// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// readTokens forces a whole-page style recalc, and the map pins rebuild on
// every venue read. It reads the theme once per set of theme inputs.
async function freshReadTokens() {
  vi.resetModules();
  return (await import("@/components/map/canvas/tokens")).readTokens;
}

describe("readTokens holds one read per set of theme inputs", () => {
  let computed: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.setAttribute("style", "--ink: #101010");
    computed = vi.spyOn(window, "getComputedStyle");
  });

  afterEach(() => {
    computed.mockRestore();
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-theme");
    for (const sheet of document.querySelectorAll("style[data-test]")) sheet.remove();
  });

  it("returns the held tokens without touching computed styles", async () => {
    const readTokens = await freshReadTokens();
    const first = readTokens();
    const reads = computed.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    expect(readTokens()).toBe(first);
    expect(computed.mock.calls.length).toBe(reads);
    expect(document.querySelectorAll("html > span[hidden]")).toHaveLength(0);
  });

  it("reads again when the theme switches", async () => {
    const readTokens = await freshReadTokens();
    const light = readTokens();
    document.documentElement.dataset.theme = "dark";
    document.documentElement.setAttribute("style", "--ink: #f0f0f0");
    const dark = readTokens();
    expect(dark).not.toBe(light);
    expect(dark.ink).toBe("#f0f0f0");
    expect(readTokens()).toBe(dark);
  });

  it("reads again when a stylesheet joins the page", async () => {
    const readTokens = await freshReadTokens();
    const before = readTokens();
    const sheet = document.createElement("style");
    sheet.dataset.test = "";
    sheet.textContent = ":root { --muted: #445566; }";
    document.head.appendChild(sheet);
    expect(readTokens()).not.toBe(before);
  });

  it("keeps reading while no theme stylesheet has applied", async () => {
    document.documentElement.removeAttribute("style");
    const readTokens = await freshReadTokens();
    const fallback = readTokens();
    expect(fallback.ink).toBe("#1b2620");
    expect(readTokens()).not.toBe(fallback);
  });
});
