// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: { user: null, loading: false, configured: false },
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));

import PalExperience from "@/components/pal/PalExperience";
import {
  anonymousPalDraftOwner,
  DEFAULT_PAL_DRAFT,
  writePalOnboardingDraft,
} from "@/lib/pubPal";

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function buttonContaining(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(PalExperience));
  });
  await settle();
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe("Pub Pal first meeting and onboarding", () => {
  it("lets a fresh visitor meet Pub Pal before making a Crawl Route", () => {
    const image = container.querySelector<HTMLImageElement>('img[alt="Pub Pal"]');
    expect(image?.src).toContain("/pal/circuit-robin-");
    expect(buttonContaining("Meet your Pub Pal")).toBeTruthy();
    expect(container.textContent).not.toContain("First, describe your night.");
  });

  it("resumes a returning guest at the saved setup step", async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    const owner = anonymousPalDraftOwner();
    writePalOnboardingDraft(owner, {
      step: 2,
      draft: {
        ...DEFAULT_PAL_DRAFT,
        adultConfirmed: true,
        name: "Moss",
      },
      privacy: {
        proposeMemories: false,
        visible: true,
        muted: false,
      },
    });

    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(PalExperience));
    });
    await settle();

    expect(container.textContent).toContain("3 of 5");
    expect(container.textContent).toContain("Tune the signal.");
    expect(container.textContent).not.toContain("Meet your Pub Pal");
  });

  it("switches from the default robin to a legacy form", async () => {
    await act(async () => {
      buttonContaining("Meet your Pub Pal").click();
    });
    const adultCheck = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(adultCheck).not.toBeNull();

    await act(async () => {
      adultCheck!.click();
    });
    await act(async () => {
      buttonContaining("Continue").click();
    });

    const robin = buttonContaining("Circuit Robin");
    const greyhound = buttonContaining("Greyhound");
    expect(robin.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('img[alt="Pub Pal"]')).not.toBeNull();

    await act(async () => {
      greyhound.click();
    });

    expect(robin.getAttribute("aria-pressed")).toBe("false");
    expect(greyhound.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".palRigGreyhound")).not.toBeNull();
    expect(container.querySelector('img[alt="Pub Pal"]')).toBeNull();
  });

  it("offers Talk and Text with the chosen Pal before account creation", async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    const owner = anonymousPalDraftOwner();
    writePalOnboardingDraft(owner, {
      step: 4,
      draft: {
        ...DEFAULT_PAL_DRAFT,
        adultConfirmed: true,
        name: "Moss",
        appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "cat" },
      },
      privacy: {
        proposeMemories: false,
        visible: true,
        muted: false,
      },
    });

    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(PalExperience));
    });
    await settle();

    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    const talk = links.find((link) => link.textContent?.includes("Talk to Moss"));
    const text = links.find((link) => link.textContent?.includes("Text Moss"));
    expect(talk).toBeTruthy();
    expect(text).toBeTruthy();
    const talkUrl = new URL(talk!.href);
    const textUrl = new URL(text!.href);
    expect(talkUrl.pathname).toBe("/pal/chat");
    expect(talkUrl.searchParams.get("trial")).toBe("1");
    expect(talkUrl.searchParams.get("mode")).toBe("talk");
    expect(talkUrl.searchParams.get("pal")).toBe("cat");
    expect(textUrl.searchParams.get("mode")).toBe("text");
  });

  it("offers Text only when the guest disabled voice controls", async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    const owner = anonymousPalDraftOwner();
    writePalOnboardingDraft(owner, {
      step: 4,
      draft: {
        ...DEFAULT_PAL_DRAFT,
        adultConfirmed: true,
        name: "Moss",
      },
      privacy: {
        proposeMemories: false,
        visible: true,
        muted: true,
      },
    });

    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(PalExperience));
    });
    await settle();

    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.some((link) => link.textContent?.includes("Talk to Moss"))).toBe(false);
    const text = links.find((link) => link.textContent?.includes("Text Moss"));
    expect(text).toBeTruthy();
    expect(new URL(text!.href).searchParams.get("mode")).toBe("text");
  });
});
