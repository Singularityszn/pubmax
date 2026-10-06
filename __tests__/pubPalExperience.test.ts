// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, loading: false, configured: false },
}));
const transport = vi.hoisted(() => ({ request: vi.fn<typeof fetch>() }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", async (original) => ({
  ...(await original<typeof import("@/lib/authedFetch")>()),
  authedActionFetch: transport.request,
}));

import PalExperience from "@/components/pal/PalExperience";
import {
  anonymousPalDraftOwner,
  DEFAULT_PAL_DRAFT,
  writePalOnboardingDraft,
  type PubPal,
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
  authState.current = { user: null, loading: false, configured: false };
  transport.request.mockReset();
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
  authState.current = { user: null, loading: false, configured: false };
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

  // The meeting screen paints before the viewer's session answers, so Meet can
  // be tapped while auth is still loading. The owner settle that follows used
  // to reset the mode to the meeting and silently drop that tap.
  it("keeps a Meet tap made before the session answers", async () => {
    await act(async () => {
      root?.unmount();
    });
    authState.current = { user: null, loading: true, configured: true };
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(PalExperience));
    });
    await settle();

    await act(async () => {
      buttonContaining("Meet your Pub Pal").click();
    });
    authState.current = { user: null, loading: false, configured: true };
    await act(async () => {
      root?.render(createElement(PalExperience));
    });
    await settle();

    expect(container.textContent).toContain("The grown-up bit first.");
    expect(container.textContent).toContain("1 of 5");
  });

  it("switches from the default robin to another rendered form", async () => {
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
    // The greyhound ships a master of its own, so the portrait becomes that
    // photograph rather than the robin's.
    expect(container.querySelector('img[alt="Pub Pal"]')?.getAttribute("src")).toContain("circuit-greyhound");
  });
});

describe("Pub Pal home appearance description", () => {
  it.each([
    ["beer", "Your amber robin, set up for your nights out. You decide what it can do."],
    ["gin", "Your crystal robin, set up for your nights out. You decide what it can do."],
    ["rum", "Your copper robin, set up for your nights out. You decide what it can do."],
    ["whisky", "Your faceted robin, set up for your nights out. You decide what it can do."],
    ["brandy", "Your polished robin, set up for your nights out. You decide what it can do."],
    ["vodka", "Your ice robin, set up for your nights out. You decide what it can do."],
  ] as const)("describes a %s Pal without an incorrect indefinite article", async (signalAffinity, description) => {
    await act(async () => root?.unmount());
    const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const timestamp = "2026-10-04T12:00:00.000Z";
    const pal: PubPal = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ownerId,
      name: "Moss",
      adultAttestedAt: timestamp,
      appearance: { ...DEFAULT_PAL_DRAFT.appearance, signalAffinity },
      personality: DEFAULT_PAL_DRAFT.personality,
      voice: DEFAULT_PAL_DRAFT.voice,
      muted: true,
      hidden: false,
      proposalPreferences: { memories: false, routes: true },
      masteryPoints: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    authState.current = { user: { id: ownerId }, loading: false, configured: true };
    transport.request.mockImplementation(async (input) => {
      if (input === "/api/pub-pal") return Response.json({ pal });
      if (input === "/api/pub-pal/memories") return Response.json({ memories: [] });
      throw new Error(`Unexpected Pal request: ${String(input)}`);
    });
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();

    expect(container.querySelector("#pal-home-title")?.textContent).toBe("Moss");
    expect(container.querySelector("#pal-home-title + p")?.textContent).toBe(description);
  });
});

describe("Pub Pal setup for a signed-in account", () => {
  const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const timestamp = "2026-10-04T12:00:00.000Z";
  const pal: PubPal = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ownerId,
    name: "Moss",
    adultAttestedAt: timestamp,
    appearance: DEFAULT_PAL_DRAFT.appearance,
    personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice,
    muted: false,
    hidden: false,
    proposalPreferences: { memories: false, routes: true },
    masteryPoints: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  beforeEach(() => {
    // jsdom does not implement scrollTo; creating a Pal asks for the top.
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  async function renderSignedIn(adultOnFile: boolean): Promise<void> {
    await act(async () => root?.unmount());
    authState.current = { user: { id: ownerId }, loading: false, configured: true };
    transport.request.mockImplementation(async (input, init) => {
      if (input === "/api/pub-pal" && init?.method === "POST") return Response.json({ pal }, { status: 201 });
      if (input === "/api/pub-pal") return Response.json({ pal: null, adultOnFile });
      if (input === "/api/pub-pal/memories") return Response.json({ memories: [] });
      throw new Error(`Unexpected Pal request: ${String(input)}`);
    });
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();
    await act(async () => buttonContaining("Meet your Pub Pal").click());
    await settle();
  }

  it("asks the 18+ question when the account has not answered it", async () => {
    await renderSignedIn(false);

    expect(container.textContent).toContain("1 of 5");
    expect(container.textContent).toContain("The grown-up bit first.");
    expect(container.querySelector("input[type=checkbox]")).not.toBeNull();
  });

  it("starts at the Pal, and counts four steps, when the account already answered as an adult", async () => {
    await renderSignedIn(true);

    // We ask once: the account's own answer stands, so there is no second tap.
    expect(container.textContent).not.toContain("The grown-up bit first.");
    expect(container.querySelector("input[type=checkbox]")).toBeNull();
    expect(container.textContent).toContain("1 of 4");
    expect(container.textContent).toContain("Who finds you?");

    // Back from the first step leaves setup, it does not open the skipped one.
    await act(async () => buttonContaining("Back").click());
    await settle();
    expect(container.textContent).toContain("Meet your Pub Pal");
  });

  it("sends the confirmation with the Pal when the question was skipped", async () => {
    await renderSignedIn(true);
    await act(async () => {
      const name = container.querySelector<HTMLInputElement>("input[placeholder='Anything feels right']")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Moss");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    for (let step = 0; step < 3; step += 1) {
      await act(async () => buttonContaining("Continue").click());
      await settle();
    }
    await act(async () => buttonContaining("Create my Pal").click());
    await settle();

    const create = transport.request.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({ adultConfirmed: true, name: "Moss" });
  });

  it("opens the new home screen at the top, on the Pal's name", async () => {
    await renderSignedIn(true);
    const scrollTo = vi.mocked(window.scrollTo);
    await act(async () => {
      const name = container.querySelector<HTMLInputElement>("input[placeholder='Anything feels right']")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Moss");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    for (let step = 0; step < 3; step += 1) {
      await act(async () => buttonContaining("Continue").click());
      await settle();
    }
    await act(async () => buttonContaining("Create my Pal").click());
    await settle();

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
    expect(document.activeElement?.id).toBe("pal-home-title");
  });

  it("says the voice control allows voice, not that voice is available", async () => {
    await act(async () => root?.unmount());
    authState.current = { user: { id: ownerId }, loading: false, configured: true };
    transport.request.mockImplementation(async (input) => {
      if (input === "/api/pub-pal") return Response.json({ pal });
      if (input === "/api/pub-pal/memories") return Response.json({ memories: [] });
      throw new Error(`Unexpected Pal request: ${String(input)}`);
    });
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();

    // Whether voice is switched on in this deployment is the hero card's claim,
    // from the voice probe. This control is the person's own mute setting.
    expect(container.textContent).toContain("Voice allowed");
    expect(container.textContent).not.toContain("Voice available");
  });
});

describe("Pub Pal control saving", () => {
  it("rolls a failed mute back and tells the reader the setting did not save", async () => {
    await act(async () => root?.unmount());
    const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const timestamp = "2026-10-04T12:00:00.000Z";
    const pal: PubPal = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ownerId,
      name: "Moss",
      adultAttestedAt: timestamp,
      appearance: DEFAULT_PAL_DRAFT.appearance,
      personality: DEFAULT_PAL_DRAFT.personality,
      voice: DEFAULT_PAL_DRAFT.voice,
      muted: false,
      hidden: false,
      proposalPreferences: { memories: false, routes: true },
      masteryPoints: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    authState.current = { user: { id: ownerId }, loading: false, configured: true };
    transport.request.mockImplementation(async (input, init) => {
      if (input === "/api/pub-pal" && init?.method === "PATCH") return Response.json({}, { status: 500 });
      if (input === "/api/pub-pal") return Response.json({ pal });
      if (input === "/api/pub-pal/memories") return Response.json({ memories: [] });
      throw new Error(`Unexpected Pal request: ${String(input)}`);
    });
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();

    await act(async () => {
      buttonContaining("Tap to mute everywhere").click();
    });
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe("We couldn't save that Pal setting.");
    expect(buttonContaining("Voice allowed").getAttribute("aria-pressed")).toBe("false");
  });
});
