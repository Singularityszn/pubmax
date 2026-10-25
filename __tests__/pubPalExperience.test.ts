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
import { subscribeLocalPal } from "@/lib/localPal";
import {
  anonymousPalDraftOwner,
  DEFAULT_PAL_DRAFT,
  readPalOnboardingDraft,
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
  it("keeps saved character settings without offering controls that cannot change replies", async () => {
    await act(async () => root?.unmount());
    const owner = anonymousPalDraftOwner();
    const personality = { relationship: "confidant" as const, playfulness: 12, energy: 34, storytelling: 56 };
    writePalOnboardingDraft(owner, {
      step: 3,
      draft: { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Moss", personality },
      privacy: { proposeMemories: false, visible: true, muted: false },
    });
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();

    expect(container.textContent).toContain("Choose a voice.");
    expect(container.textContent).toContain("Character settings do not change replies yet.");
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect([...container.querySelectorAll("legend")].map((legend) => legend.textContent)).not.toContain("Relationship");
    await act(async () => buttonContaining("Velvet").click());
    await settle();
    expect(buttonContaining("Velvet").getAttribute("aria-pressed")).toBe("true");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(readPalOnboardingDraft(owner)?.draft.personality).toEqual(personality);
    expect(readPalOnboardingDraft(owner)?.draft.voice.id).toBe("velvet");
    await act(async () => buttonContaining("Continue").click());
    await settle();
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(container.textContent).not.toContain("Relationship");
    expect(readPalOnboardingDraft(owner)?.draft.personality).toEqual(personality);
  });

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
    expect(container.textContent).toContain("Choose its look");
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

    expect(container.textContent).toContain("Before you start");
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
    expect(container.textContent).toContain("Before you start");
    expect(container.querySelector("input[type=checkbox]")).not.toBeNull();
  });

  it("starts at the Pal, and counts four steps, when the account already answered as an adult", async () => {
    await renderSignedIn(true);

    // We ask once: the account's own answer stands, so there is no second tap.
    expect(container.textContent).not.toContain("Before you start");
    expect(container.querySelector("input[type=checkbox]")).toBeNull();
    expect(container.textContent).toContain("1 of 4");
    expect(container.textContent).toContain("Choose your Pub Pal");

    // Back from the first step leaves setup, it does not open the skipped one.
    await act(async () => buttonContaining("Back").click());
    await settle();
    expect(container.textContent).toContain("Meet your Pub Pal");
  });

  it("does not let browser Back restore the hidden 18+ step", async () => {
    await renderSignedIn(true);
    expect(container.textContent).toContain("Choose your Pub Pal");

    // Walk forward one step, then use the real browser Back twice. The first
    // lands on the first visible step, the second on the entry the wizard
    // opened on. Neither may show the hidden step, and Back must not push a
    // replacement entry.
    await act(async () => {
      const name = container.querySelector<HTMLInputElement>("input[placeholder='Any name you like']")!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Moss");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonContaining("Continue").click());
    await settle();
    expect(container.textContent).not.toContain("Choose your Pub Pal");
    const entries = window.history.length;

    for (let press = 0; press < 2; press += 1) {
      await act(async () => {
        window.history.back();
      });
      await settle();
      expect(container.textContent).not.toContain("Before you start");
    }

    expect(container.textContent).toContain("Choose your Pub Pal");
    expect(window.history.length).toBeLessThanOrEqual(entries);
  });

  it("sends the confirmation with the Pal when the question was skipped", async () => {
    await renderSignedIn(true);
    await act(async () => {
      const name = container.querySelector<HTMLInputElement>("input[placeholder='Any name you like']")!;
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
      const name = container.querySelector<HTMLInputElement>("input[placeholder='Any name you like']")!;
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

  it("wakes the Pal with a stretch once the server keeps an unmute, and only then", async () => {
    await act(async () => root?.unmount());
    const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const timestamp = "2026-10-04T12:00:00.000Z";
    let pal: PubPal = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ownerId,
      name: "Moss",
      adultAttestedAt: timestamp,
      appearance: DEFAULT_PAL_DRAFT.appearance,
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
    transport.request.mockImplementation(async (input, init) => {
      if (input === "/api/pub-pal" && init?.method === "PATCH") {
        pal = { ...pal, ...(JSON.parse(String(init.body)) as Partial<PubPal>) };
        return Response.json({ pal });
      }
      if (input === "/api/pub-pal") return Response.json({ pal, adultOnFile: true });
      if (input === "/api/pub-pal/memories") return Response.json({ memories: [] });
      throw new Error(`Unexpected Pal request: ${String(input)}`);
    });
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();
    const portraitState = () => container.querySelector(".palHomePortrait .palPortrait")?.getAttribute("data-pal-state");
    const speech = () => container.querySelector(".palHomePortrait .palSpeech")?.textContent;
    expect(portraitState()).toBe("sleeping");

    await act(async () => buttonContaining("Tap to allow voice").click());
    await settle();
    expect(portraitState()).toBe("waking");
    expect(speech()).toBe("Awake. I'll speak when you ask.");

    // Muting is a plain "saved", never a wake.
    await act(async () => buttonContaining("Tap to mute everywhere").click());
    await settle();
    expect(portraitState()).toBe("sleeping");
  });

  it("leaves no animation timer behind when the page closes mid-stretch", async () => {
    await act(async () => root?.unmount());
    const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const timestamp = "2026-10-04T12:00:00.000Z";
    let pal: PubPal = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ownerId,
      name: "Moss",
      adultAttestedAt: timestamp,
      appearance: DEFAULT_PAL_DRAFT.appearance,
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
    transport.request.mockImplementation(async (input, init) => {
      if (input === "/api/pub-pal" && init?.method === "PATCH") {
        pal = { ...pal, ...(JSON.parse(String(init.body)) as Partial<PubPal>) };
        return Response.json({ pal });
      }
      if (input === "/api/pub-pal") return Response.json({ pal, adultOnFile: true });
      if (input === "/api/pub-pal/memories") return Response.json({ memories: [] });
      throw new Error(`Unexpected Pal request: ${String(input)}`);
    });
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => buttonContaining("Tap to allow voice").click());
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(container.querySelector(".palHomePortrait .palPortrait")?.getAttribute("data-pal-state")).toBe("waking");
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await act(async () => root?.unmount());
      root = null;
      // The stretch would end at 1.4 seconds; after unmount nothing is left to fire.
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(5_000);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the Pal's door in this same tab each time it saves the Pal", async () => {
    await act(async () => root?.unmount());
    const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const timestamp = "2026-10-04T12:00:00.000Z";
    let pal: PubPal = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId, name: "Moss", adultAttestedAt: timestamp,
      appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
      muted: true, hidden: false, proposalPreferences: { memories: false, routes: true }, masteryPoints: 0,
      createdAt: timestamp, updatedAt: timestamp,
    };
    authState.current = { user: { id: ownerId }, loading: false, configured: true };
    transport.request.mockImplementation(async (input, init) => {
      if (input === "/api/pub-pal" && init?.method === "PATCH") {
        pal = { ...pal, ...(JSON.parse(String(init.body)) as Partial<PubPal>) };
        return Response.json({ pal });
      }
      if (input === "/api/pub-pal") return Response.json({ pal, adultOnFile: true });
      if (input === "/api/pub-pal/memories") return Response.json({ memories: [] });
      throw new Error(`Unexpected Pal request: ${String(input)}`);
    });
    // Browsers send "storage" only to other tabs, so this is the same-tab signal.
    const heard = vi.fn();
    const unsubscribe = subscribeLocalPal(heard);
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();
    heard.mockClear();
    await act(async () => buttonContaining("Tap to allow voice").click());
    await settle();
    expect(heard).toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem("pubmax_pub_pal_v1") ?? "null")?.muted).toBe(false);
    unsubscribe();
  });
});

describe("Pub Pal shown to the crew", () => {
  it("is private until the person turns it on, and saves only that choice", async () => {
    await act(async () => root?.unmount());
    const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const timestamp = "2026-10-04T12:00:00.000Z";
    let pal: PubPal = {
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
    const patches: unknown[] = [];
    authState.current = { user: { id: ownerId }, loading: false, configured: true };
    transport.request.mockImplementation(async (input, init) => {
      if (input === "/api/pub-pal" && init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body)) as Partial<PubPal>;
        patches.push(patch);
        pal = { ...pal, ...patch };
        return Response.json({ pal });
      }
      if (input === "/api/pub-pal") return Response.json({ pal, adultOnFile: true });
      if (input === "/api/pub-pal/memories") return Response.json({ memories: [] });
      throw new Error(`Unexpected Pal request: ${String(input)}`);
    });
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();

    expect(buttonContaining("Private to you").getAttribute("aria-pressed")).toBe("false");
    await act(async () => buttonContaining("Tap to let your crew see it walk on a plan's map").click());
    await settle();
    expect(patches).toEqual([{ crewVisible: true }]);
    expect(buttonContaining("Shown to your crew").getAttribute("aria-pressed")).toBe("true");

    await act(async () => buttonContaining("Shown to your crew").click());
    await settle();
    expect(patches).toEqual([{ crewVisible: true }, { crewVisible: false }]);
    expect(buttonContaining("Private to you").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Pub Pal when the browser refuses storage", () => {
  // A full or blocked localStorage costs the cached copy of the Pal, never the
  // Pal itself or a working toggle: a write that throws must not drop the
  // server's Pal on load, and must not leave the control lock held.
  it("still loads the server's Pal and keeps every toggle working", async () => {
    await act(async () => root?.unmount());
    const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const timestamp = "2026-10-04T12:00:00.000Z";
    let pal: PubPal = {
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
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    authState.current = { user: { id: ownerId }, loading: false, configured: true };
    let patches = 0;
    transport.request.mockImplementation(async (input, init) => {
      if (input === "/api/pub-pal" && init?.method === "PATCH") {
        patches += 1;
        pal = { ...pal, ...(JSON.parse(String(init.body)) as Partial<PubPal>) };
        return Response.json({ pal });
      }
      if (input === "/api/pub-pal") return Response.json({ pal, adultOnFile: true });
      if (input === "/api/pub-pal/memories") return Response.json({ memories: [] });
      throw new Error(`Unexpected Pal request: ${String(input)}`);
    });
    root = createRoot(container);
    await act(async () => root?.render(createElement(PalExperience)));
    await settle();

    expect(container.querySelector("#pal-home-title")?.textContent).toBe("Moss");

    await act(async () => buttonContaining("Tap to mute everywhere").click());
    await settle();
    expect(buttonContaining("Muted").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => buttonContaining("Tap to allow voice").click());
    await settle();
    expect(patches).toBe(2);
    expect(buttonContaining("Voice allowed").getAttribute("aria-pressed")).toBe("false");

    // A Pal saved before the taste key existed reads as on.
    expect(buttonContaining("Taste read on").getAttribute("aria-pressed")).toBe("true");
    await act(async () => buttonContaining("Taste read on").click());
    await settle();
    expect(patches).toBe(3);
    expect(pal.proposalPreferences).toEqual({ memories: false, routes: true, taste: false });
    expect(buttonContaining("Taste read off").getAttribute("aria-pressed")).toBe("false");
    expect(buttonContaining("Pal won't read your favourite drink, diary, drops or saves")).toBeTruthy();
  });
});
