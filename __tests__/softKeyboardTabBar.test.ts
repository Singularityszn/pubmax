// The phone tab bar must not float over the field somebody is typing into.
//
// The captain's screenshot was the password form with the six tabs sitting on
// top of it. A fixed bottom bar is pinned to the LAYOUT viewport, which neither
// iOS Safari nor Android Chrome shrink for the keyboard, so the bar keeps its
// place while the keyboard rises past it.
//
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SOFT_KEYBOARD_MIN_SHRINK_RATIO,
  isTextEntryElement,
  softKeyboardOpen,
} from "@/lib/softKeyboard";

vi.mock("next/navigation", () => ({
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
    push: () => undefined,
    replace: () => undefined,
    prefetch: () => Promise.resolve(),
  }),
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => null,
}));

// A phone-shaped viewport: 844 CSS pixels tall, the keyboard taking ~300 of it.
const PHONE_LAYOUT_HEIGHT = 844;
const WITH_KEYBOARD = 544;

function evidence(over: Partial<Parameters<typeof softKeyboardOpen>[0]> = {}) {
  return {
    textEntryFocused: true,
    visualViewportHeight: WITH_KEYBOARD,
    layoutViewportHeight: PHONE_LAYOUT_HEIGHT,
    ...over,
  };
}

describe("what counts as a keyboard", () => {
  it("needs BOTH a focused text field and a shrunken visual viewport", () => {
    expect(softKeyboardOpen(evidence())).toBe(true);
    // A caret with no shrink is a physical keyboard, an iPad with a Magic
    // Keyboard, or a desktop browser. Nothing is covering the bar.
    expect(
      softKeyboardOpen(evidence({ visualViewportHeight: PHONE_LAYOUT_HEIGHT })),
    ).toBe(false);
    // A shrink with no caret is the URL bar, a find strip, or pinch zoom.
    expect(softKeyboardOpen(evidence({ textEntryFocused: false }))).toBe(false);
  });

  it("holds the browser-chrome band below the threshold and the keyboard above it", () => {
    const floor = PHONE_LAYOUT_HEIGHT * SOFT_KEYBOARD_MIN_SHRINK_RATIO;
    // A collapsing URL bar costs about a tenth of the viewport.
    expect(
      softKeyboardOpen(
        evidence({ visualViewportHeight: PHONE_LAYOUT_HEIGHT - floor + 1 }),
      ),
    ).toBe(false);
    expect(
      softKeyboardOpen(
        evidence({ visualViewportHeight: PHONE_LAYOUT_HEIGHT - floor }),
      ),
    ).toBe(true);
  });

  it("answers false when the viewport cannot be measured", () => {
    // A browser with no visualViewport has not told us there is a keyboard.
    // Hiding the navigation on that costs more than leaving it up.
    expect(softKeyboardOpen(evidence({ visualViewportHeight: Number.NaN }))).toBe(false);
    expect(softKeyboardOpen(evidence({ layoutViewportHeight: 0 }))).toBe(false);
  });
});

describe("which elements raise a keyboard", () => {
  const element = (tag: string, type?: string) =>
    ({
      tagName: tag.toUpperCase(),
      getAttribute: (name: string) => (name === "type" ? (type ?? null) : null),
    }) as unknown as Element;

  it("counts text inputs, a bare input, and a textarea", () => {
    expect(isTextEntryElement(element("input", "password"))).toBe(true);
    expect(isTextEntryElement(element("input", "search"))).toBe(true);
    expect(isTextEntryElement(element("input", "email"))).toBe(true);
    // No type attribute IS a text input.
    expect(isTextEntryElement(element("input"))).toBe(true);
    expect(isTextEntryElement(element("textarea"))).toBe(true);
  });

  it("refuses controls that raise nothing, and an unfocused document", () => {
    expect(isTextEntryElement(element("input", "checkbox"))).toBe(false);
    expect(isTextEntryElement(element("input", "radio"))).toBe(false);
    expect(isTextEntryElement(element("input", "submit"))).toBe(false);
    expect(isTextEntryElement(element("input", "file"))).toBe(false);
    expect(isTextEntryElement(element("input", "range"))).toBe(false);
    expect(isTextEntryElement(element("button"))).toBe(false);
    expect(isTextEntryElement(element("body"))).toBe(false);
    expect(isTextEntryElement(null)).toBe(false);
  });

  it("counts an editable host, because it raises the same keyboard", () => {
    const editable = { tagName: "DIV", isContentEditable: true } as unknown as Element;
    expect(isTextEntryElement(editable)).toBe(true);
  });
});

describe("what the tab bar renders for each answer", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/softKeyboard");
    vi.doUnmock("@/lib/useFocusTrap");
  });

  async function renderBar(
    keyboardOpen: boolean,
    strictModalOpen = false,
  ): Promise<string> {
    vi.doMock("@/lib/softKeyboard", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/softKeyboard")>()),
      subscribeSoftKeyboard: () => () => {},
      readSoftKeyboardOpen: () => keyboardOpen,
      serverSoftKeyboardOpen: () => keyboardOpen,
    }));
    vi.doMock("@/lib/useFocusTrap", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/useFocusTrap")>()),
      subscribeStrictModalFocusTrap: () => () => {},
      readStrictModalFocusTrap: () => strictModalOpen,
      serverStrictModalFocusTrap: () => strictModalOpen,
    }));
    vi.resetModules();
    const { default: MobileTabBar } = await import("@/components/nav/MobileTabBar");
    return renderToStaticMarkup(createElement(MobileTabBar));
  }

  // The nav's OWN opening tag. Every icon inside it is aria-hidden by design,
  // so asking the whole markup would answer about a decorative svg.
  const navTag = (markup: string): string => markup.slice(0, markup.indexOf(">") + 1);

  it("keeps the bar in place with no keyboard on screen", async () => {
    const markup = await renderBar(false);
    expect(navTag(markup)).toContain('class="mobileTabBar"');
    expect(navTag(markup)).not.toContain("isKeyboardHidden");
    expect(navTag(markup)).not.toContain("aria-hidden");
    expect(navTag(markup)).not.toMatch(/\binert\b/);
    expect(navTag(markup)).toContain("data-focus-trap-exempt");
    expect(markup).toContain("Tonight");
  });

  it("hides the bar - and takes it out of the tab order - while the keyboard is up", async () => {
    const markup = await renderBar(true);
    expect(navTag(markup)).toContain("isKeyboardHidden");
    // A bar that has slid off the bottom of the screen must not still be
    // reachable by a screen reader or by the keyboard's own next-field key.
    expect(navTag(markup)).toContain('aria-hidden="true"');
    expect(navTag(markup)).toMatch(/\binert\b/);
    // It is hidden, not unmounted: the tabs come straight back on blur with no
    // re-render of the destination list.
    expect(markup).toContain("Tonight");
  });

  it("keeps the bar inert after a strict modal outlives the keyboard", async () => {
    const markup = await renderBar(false, true);
    expect(navTag(markup)).not.toContain("isKeyboardHidden");
    expect(navTag(markup)).not.toContain("aria-hidden");
    expect(navTag(markup)).toMatch(/\binert\b/);
  });
});
