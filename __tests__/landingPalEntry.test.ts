// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    createElement("a", props, children)
  ),
}));
vi.mock("@/components/pal/PalPortrait", () => ({
  default: ({ name }: { name: string }) => createElement("div", { "data-testid": "pal-preview" }, name),
}));

import LandingPalEntry from "@/components/landing/LandingPalEntry";
import {
  anonymousPalDraftOwner,
  readPalOnboardingDraft,
} from "@/lib/pubPal";

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe("landing Pub Pal entry", () => {
  it("shows every launch companion and starts with Circuit Robin", async () => {
    await act(async () => root?.render(createElement(LandingPalEntry, { onTarget: () => undefined })));

    expect(container.textContent).toContain("Choose your Pub Pal");
    expect(container.querySelectorAll(".lpPalChoice")).toHaveLength(7);
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toContain("Circuit Robin");
    expect(container.querySelector('[data-testid="pal-preview"]')?.textContent).toContain("Circuit Robin");
    expect(container.querySelector('a[href="/pal/chat?mode=talk&pal=robin"]')?.textContent).toContain("Talk");
    expect(container.querySelector('a[href="/pal/chat?mode=text&pal=robin"]')?.textContent).toContain("Text");
  });

  it("preserves the chosen companion and modality for guest chat and account setup", async () => {
    const onTarget = vi.fn();
    await act(async () => root?.render(createElement(LandingPalEntry, { onTarget })));

    const fox = [...container.querySelectorAll<HTMLButtonElement>(".lpPalChoice")]
      .find((button) => button.textContent?.includes("Fox"));
    expect(fox).toBeTruthy();
    await act(async () => fox?.click());

    const talk = container.querySelector<HTMLAnchorElement>('a[href="/pal/chat?mode=talk&pal=fox"]');
    expect(talk).toBeTruthy();
    await act(async () => talk?.click());

    expect(onTarget).toHaveBeenCalledWith("pal_talk");
    expect(readPalOnboardingDraft(anonymousPalDraftOwner())).toMatchObject({
      step: 0,
      draft: { appearance: { species: "fox" } },
    });
  });
});
