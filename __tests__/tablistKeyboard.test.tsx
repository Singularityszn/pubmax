// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import SocialTabs from "@/components/feed/SocialTabs";
import { moveTablistFocus } from "@/components/ui/tabs";

// ─────────────────────────────────────────────────────────────────────────────
// A TAB ROW IS ONE TAB STOP (docs/DESIGN_SYSTEM.md "Tabs"; rule:
// docs/rules/components-design-system-and-launch-primitives.md).
//
// The design-system tab audit (17 Oct 2026) found seven tab rows and four
// keyboard contracts: the venue sheet and the Tabs primitive roved focus with
// the arrows, while the sign-in doors, the Social feed axis, the soft-drink
// chips and the admin sections put every tab in the Tab order and answered no
// arrow. `moveTablistFocus` in components/ui/tabs.tsx is now the ONE keyboard
// half, and every `role="tab"` in the tree carries a roving tabIndex and a
// keydown handler.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();

function sources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx")) files.push(relative(ROOT, path));
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "components"));
  return files;
}

/** The JSX element around each `role="tab"`: from its `<button` to its close. */
function tabElements(source: string): string[] {
  const out: string[] = [];
  // A JSX attribute, not the `[role="tab"]` selector the helper queries with.
  for (const match of source.matchAll(/(?<=\s)role="tab"(?=[\s>])/g)) {
    const start = source.lastIndexOf("<button", match.index);
    const ends = [source.indexOf("</button>", match.index), source.indexOf("/>", match.index)].filter((i) => i >= 0);
    out.push(source.slice(start, Math.min(...ends)));
  }
  return out;
}

describe("every tab row shares one keyboard contract", () => {
  const rows = sources().filter((file) => readFileSync(join(ROOT, file), "utf8").includes('role="tablist"'));

  it("finds the tab rows the audit named", () => {
    for (const file of [
      "components/ui/tabs.tsx",
      "components/map/inspector/VenueInspectorHeader.tsx",
      "components/auth/LoginPage.tsx",
      "components/feed/SocialTabs.tsx",
      "components/drinks/DrinkSubtypePricedView.tsx",
      "app/admin/AdminClient.tsx",
    ]) {
      expect(rows, `${file} still draws a tablist`).toContain(file);
    }
  });

  for (const file of sources()) {
    const source = readFileSync(join(ROOT, file), "utf8");
    const tabs = tabElements(source);
    if (tabs.length === 0) continue;
    it(`${file}: every tab roves and answers the arrows`, () => {
      tabs.forEach((tab, index) => {
        expect(tab, `tab ${index} in ${file} sets a roving tabIndex`).toMatch(/tabIndex=\{/);
        expect(tab, `tab ${index} in ${file} handles its keys`).toMatch(/onKeyDown=\{/);
      });
    });
  }
});

describe("moveTablistFocus", () => {
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
  });

  function mount(node: React.ReactNode): HTMLDivElement {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(node));
    return host;
  }

  function press(target: Element, key: string) {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
  }

  it("puts one tab in the Tab order and moves along the row with the arrows", () => {
    const onChange = vi.fn();
    const el = mount(<SocialTabs active="lot" onChange={onChange} />);
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);

    tabs[0]!.focus();
    press(tabs[0]!, "ArrowRight");
    expect(document.activeElement).toBe(tabs[1]);
    expect(onChange).toHaveBeenLastCalledWith("london");

    press(tabs[1]!, "ArrowRight");
    expect(document.activeElement, "the row wraps").toBe(tabs[0]);

    press(tabs[0]!, "End");
    expect(document.activeElement).toBe(tabs[1]);
    press(tabs[1]!, "Home");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("moves focus alone when the row chooses on Enter", () => {
    const chosen = vi.fn();
    const el = mount(
      <div role="tablist">
        {["Cola", "Water"].map((label, index) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={index === 0}
            tabIndex={index === 0 ? 0 : -1}
            onClick={() => chosen(label)}
            onKeyDown={(event) => moveTablistFocus(event, { activate: false })}
          >
            {label}
          </button>
        ))}
      </div>,
    );
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[0]!.focus();
    press(tabs[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(tabs[1]);
    expect(chosen).not.toHaveBeenCalled();
  });

  it("leaves every other key to the browser", () => {
    const el = mount(<SocialTabs active="lot" onChange={() => undefined} />);
    const tab = el.querySelector<HTMLButtonElement>('[role="tab"]')!;
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => {
      tab.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
