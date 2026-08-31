// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
  }) => {
    void prefetch;
    return createElement("a", { href: String(href), ...props }, children);
  },
}));

import LandingPalEntry from "@/components/landing/LandingPalEntry";
import { readPalGuestTrial } from "@/lib/palGuestTrial";
import {
  anonymousPalDraftOwner,
  DEFAULT_PAL_DRAFT,
  readPalOnboardingDraft,
  writePalOnboardingDraft,
} from "@/lib/pubPal";

let container: HTMLDivElement;
let root: Root | null = null;

async function renderEntry(onTarget = vi.fn()): Promise<typeof onTarget> {
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(LandingPalEntry, { onTarget }));
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  return onTarget;
}

async function choose(label: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>(".lpPalChoice")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Missing Pal choice: ${label}`);
  await act(async () => button.click());
}

async function follow(selector: string): Promise<void> {
  const link = container.querySelector<HTMLAnchorElement>(selector);
  if (!link) throw new Error(`Missing Pal entry link: ${selector}`);
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  await act(async () => link.click());
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe("LandingPalEntry", () => {
  it("shows all seven Pub Pal choices and updates both direct chat links", async () => {
    await renderEntry();

    const choices = [...container.querySelectorAll<HTMLButtonElement>(".lpPalChoice")];
    expect(choices.map((choice) => choice.textContent?.trim())).toEqual([
      "Circuit Robin",
      "Greyhound",
      "Black Cat",
      "Fox",
      "Pigeon",
      "Badger",
      "Corgi",
    ]);
    expect(choices.map((choice) => choice.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);

    await choose("Fox");

    expect(
      container.querySelector<HTMLAnchorElement>(".lpPalModeTalk")?.getAttribute("href"),
    ).toBe("/pal/chat?trial=1&mode=talk&pal=fox");
    expect(
      container.querySelector<HTMLAnchorElement>(".lpPalModeText")?.getAttribute("href"),
    ).toBe("/pal/chat?trial=1&mode=text&pal=fox");
    expect(
      [...container.querySelectorAll<HTMLButtonElement>(".lpPalChoice")]
        .find((choice) => choice.textContent?.trim() === "Fox")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("seeds the anonymous onboarding draft and records the Talk landing target", async () => {
    const onTarget = await renderEntry();
    await choose("Badger");
    await follow(".lpPalModeTalk");

    expect(readPalGuestTrial()).toEqual({
      version: 1,
      answeredPrompts: 0,
      species: "badger",
      mode: "talk",
    });
    expect(readPalOnboardingDraft(anonymousPalDraftOwner())).toMatchObject({
      step: 0,
      draft: {
        appearance: { species: "badger" },
      },
      privacy: { proposeMemories: false, visible: true, muted: false },
    });
    expect(onTarget).toHaveBeenCalledOnce();
    expect(onTarget).toHaveBeenCalledWith("pal_talk");
  });

  it("updates only species while preserving an existing draft and privacy", async () => {
    const owner = anonymousPalDraftOwner();
    writePalOnboardingDraft(owner, {
      step: 3,
      draft: {
        ...DEFAULT_PAL_DRAFT,
        adultConfirmed: true,
        name: "Moss",
        appearance: {
          species: "cat",
          signalAffinity: "gin",
          material: "glass",
          accessory: "monocle",
        },
        personality: {
          playfulness: 23,
          energy: 45,
          storytelling: 67,
          relationship: "confidant",
        },
        voice: { id: "velvet", pace: 34, warmth: 56, energy: 78 },
      },
      privacy: { proposeMemories: true, visible: false, muted: true },
    });
    const before = readPalOnboardingDraft(owner);
    const onTarget = await renderEntry();

    await choose("Corgi");
    await follow(".lpPalModeText");

    const after = readPalOnboardingDraft(owner);
    expect(after).toMatchObject({
      step: 3,
      draft: {
        adultConfirmed: true,
        name: "Moss",
        appearance: {
          species: "corgi",
          signalAffinity: "gin",
          material: "glass",
          accessory: "monocle",
        },
        personality: before?.draft.personality,
        voice: before?.draft.voice,
      },
      privacy: before?.privacy,
    });
    expect(readPalGuestTrial()).toMatchObject({ species: "corgi", mode: "text" });
    expect(onTarget).toHaveBeenCalledWith("pal_text");

    const retained = Array.from({ length: window.localStorage.length }, (_, index) => {
      const key = window.localStorage.key(index);
      return key ? `${key}:${window.localStorage.getItem(key)}` : "";
    }).join("\n");
    expect(retained).not.toMatch(/"(?:prompt|transcript)"/i);
  });

  it("restores the chosen Pal and hides Talk when voice controls are off", async () => {
    const owner = anonymousPalDraftOwner();
    writePalOnboardingDraft(owner, {
      step: 4,
      draft: {
        ...DEFAULT_PAL_DRAFT,
        appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "cat" },
      },
      privacy: { proposeMemories: false, visible: true, muted: true },
    });

    await renderEntry();

    expect(container.querySelector(".lpPalModeTalk")).toBeNull();
    expect(
      container.querySelector<HTMLAnchorElement>(".lpPalModeText")?.getAttribute("href"),
    ).toBe("/pal/chat?trial=1&mode=text&pal=cat");
    expect(
      [...container.querySelectorAll<HTMLButtonElement>(".lpPalChoice")]
        .find((choice) => choice.textContent?.trim() === "Black Cat")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
