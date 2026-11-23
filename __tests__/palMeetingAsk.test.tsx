// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { VIBE_CHIPS } from "@/lib/vibeChips";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, prefetch: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement("a", { href }, children),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { PalMeetingScreen } = await import("@/components/pal/PalExperience");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  push.mockReset();
});

function mount(chatFirst = true) {
  act(() => {
    root.render(createElement(PalMeetingScreen, {
      appearance: DEFAULT_PAL_DRAFT.appearance,
      onMeet: () => undefined,
      chatFirst,
    }));
  });
}

function field(): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>("form input");
  if (!input) throw new Error("no chat box under the question");
  return input;
}

function type(value: string) {
  const input = field();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("/pal answers its own question (#3363)", () => {
  it("a chip fills the chat box and sends it to the chat", () => {
    mount();
    const chip = VIBE_CHIPS[0]!;
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === chip.label);
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(field().value).toBe(chip.ask);
    expect(push).toHaveBeenCalledWith(`/pal/chat?ask=${encodeURIComponent(chip.ask)}`);
  });

  it("a typed answer is sent to the chat", () => {
    mount();
    type("  quiet one near Bank  ");
    act(() => field().form!.requestSubmit());
    expect(push).toHaveBeenCalledWith(`/pal/chat?ask=${encodeURIComponent("quiet one near Bank")}`);
  });

  it("an empty box sends nothing", () => {
    mount();
    type("   ");
    act(() => field().form!.requestSubmit());
    expect(push).not.toHaveBeenCalled();
  });

  it("asks no question it gives no way to answer when the written ask is off", () => {
    mount(false);
    expect(container.querySelector("form input")).toBeNull();
    expect(container.textContent).not.toContain("What kind of night are we making?");
  });
});
