// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import RoundCodeJoin, { ROUND_CODE_HINT } from "@/components/round/RoundCodeJoin";

/**
 * /rounds used to answer "Got a code?" with "Add it to that link", so a mate
 * who was read the code out had to type it onto the end of a URL. The field
 * opens the Round from the code alone, read the way the store reads it.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(RoundCodeJoin)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function submit(value: string) {
  const input = container.querySelector<HTMLInputElement>("input")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("RoundCodeJoin", () => {
  it("opens the Round from a code typed loosely", () => {
    submit(" tq38-rq ");
    expect(push).toHaveBeenCalledWith("/rounds/TQ38RQ");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("answers a short code in place and goes nowhere", () => {
    submit("tq3");
    expect(push).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(ROUND_CODE_HINT);
    expect(container.querySelector("input")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("is a quiet secondary on /rounds, beside the starter's one primary", () => {
    expect(container.querySelector("[data-primary-action]")).toBeNull();
    const page = readFileSync(join(process.cwd(), "app/rounds/page.tsx"), "utf8");
    expect(page).toContain("action={<RoundCodeJoin />}");
    expect(page).not.toContain("Add it to that link");
  });
});
