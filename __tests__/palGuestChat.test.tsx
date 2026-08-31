// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const trackEvent = vi.hoisted(() => vi.fn());
const askSession = vi.hoisted(() => vi.fn());
const loadSlim = vi.hoisted(() => vi.fn());
const loadSlimResult = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  current: {
    user: null as { id: string } | null,
    session: null as unknown,
    loading: false,
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    createElement("a", { href: String(href), ...props }, children),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => authState.current }));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "Navigation"),
}));
vi.mock("@/components/pal/PubPalMascot", () => ({
  PubPalMascot: () => createElement("span", null, "Pal"),
}));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({ rows: [], status: "empty" }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent }));
vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenuesForCity: loadSlim,
  loadSlimVenuesForCityResult: loadSlimResult,
}));
vi.mock("@/lib/palChatClient", () => ({ createPalChatSession: () => askSession }));

import PalChat from "@/components/pal/PalChat";
import {
  anonymousPalDraftOwner,
  DEFAULT_PAL_DRAFT,
  writePalOnboardingDraft,
} from "@/lib/pubPal";

const TRIAL_KEY = "pubmaxx.pub-pal-guest-trial.v1";

let container: HTMLDivElement;
let root: Root | null = null;

const answer = {
  status: "answered" as const,
  message: "Found one Venue.",
  cards: [],
  proposals: [],
};

function seedTrial(answeredPrompts: number, mode: "talk" | "text" = "text", species = "cat") {
  window.localStorage.setItem(TRIAL_KEY, JSON.stringify({
    version: 1,
    answeredPrompts,
    mode,
    species,
  }));
}

function storedCount(): number {
  return JSON.parse(window.localStorage.getItem(TRIAL_KEY) ?? "{}")
    .answeredPrompts ?? 0;
}

function storedMode(): string | undefined {
  return JSON.parse(window.localStorage.getItem(TRIAL_KEY) ?? "{}")
    .mode;
}

async function settle(turns = 5): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
}

async function renderChat(path = "/pal/chat?trial=1"): Promise<void> {
  window.history.replaceState({}, "", path);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(PalChat));
  });
  await settle();
}

async function submit(text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(".palChatInput");
  const form = container.querySelector<HTMLFormElement>("form");
  if (!input || !form) throw new Error("Pal chat composer not found");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/pal/chat");
  authState.current = { user: null, session: null, loading: false };
  router.push.mockReset();
  trackEvent.mockReset();
  askSession.mockReset().mockResolvedValue(answer);
  loadSlim.mockReset().mockResolvedValue([]);
  loadSlimResult.mockReset().mockResolvedValue({ status: "ready", rows: [] });
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

describe("Pub Pal guest chat", () => {
  it("shows the chosen Pal and explicit Talk input without saving the transcript", async () => {
    seedTrial(0, "talk", "cat");
    const owner = anonymousPalDraftOwner();
    writePalOnboardingDraft(owner, {
      step: 4,
      draft: {
        ...DEFAULT_PAL_DRAFT,
        adultConfirmed: true,
        name: "Moss",
        appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "cat" },
      },
      privacy: { proposeMemories: false, visible: true, muted: false },
    });

    await renderChat("/pal/chat?trial=1&mode=talk&pal=cat");

    expect(container.textContent).toContain("Moss");
    expect(
      container.querySelector<HTMLButtonElement>(
        '.palGuestModeSwitch button[aria-pressed="true"]',
      )?.textContent,
    ).toContain("Talk");
    expect(container.textContent).toContain("Talk is unavailable. Type instead.");
    expect(window.localStorage.getItem(TRIAL_KEY)).not.toContain("Moss");
  });

  it("does not label a query-selected species with another draft Pal's name", async () => {
    seedTrial(0, "text", "greyhound");
    const owner = anonymousPalDraftOwner();
    writePalOnboardingDraft(owner, {
      step: 4,
      draft: {
        ...DEFAULT_PAL_DRAFT,
        adultConfirmed: true,
        name: "Moss",
        appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "cat" },
      },
      privacy: { proposeMemories: false, visible: true, muted: false },
    });

    await renderChat("/pal/chat?trial=1&mode=text&pal=greyhound");

    expect(container.textContent).toContain("Greyhound");
    expect(container.textContent).not.toContain("Moss");
    expect(container.querySelector(".palRigGreyhound")).not.toBeNull();
  });

  it("forces Text when the guest disabled voice controls", async () => {
    seedTrial(0, "talk", "cat");
    const owner = anonymousPalDraftOwner();
    writePalOnboardingDraft(owner, {
      step: 4,
      draft: {
        ...DEFAULT_PAL_DRAFT,
        adultConfirmed: true,
        name: "Moss",
        appearance: { ...DEFAULT_PAL_DRAFT.appearance, species: "cat" },
      },
      privacy: { proposeMemories: false, visible: true, muted: true },
    });

    await renderChat("/pal/chat?trial=1&mode=talk&pal=cat");

    expect(
      [...container.querySelectorAll<HTMLButtonElement>(".palGuestModeSwitch button")]
        .map((button) => button.textContent?.trim()),
    ).toEqual(["Text"]);
    expect(container.querySelector(".palTalkControl")).toBeNull();
    expect(storedMode()).toBe("text");
  });

  it("waits for restored auth before choosing guest or account UI", async () => {
    seedTrial(5);
    authState.current = { user: null, session: null, loading: true };
    await renderChat();

    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Five guest answers complete");
    expect(container.textContent).not.toContain("guest answers left");
    expect(trackEvent).not.toHaveBeenCalledWith("pub_pal_guest_trial_started");

    authState.current = {
      user: { id: "user-1" },
      session: null,
      loading: false,
    };
    await act(async () => root?.render(createElement(PalChat)));
    await settle();

    expect(container.querySelector("form")).not.toBeNull();
    expect(container.textContent).not.toContain("Five guest answers complete");
    expect(trackEvent).not.toHaveBeenCalledWith("pub_pal_guest_trial_started");
  });

  it("starts analytics on the first completed answer, not on mount", async () => {
    seedTrial(0, "text");
    await renderChat();

    expect(trackEvent).not.toHaveBeenCalledWith("pub_pal_guest_trial_started");
    expect(trackEvent).not.toHaveBeenCalledWith(
      "pub_pal_guest_mode_selected",
      expect.anything(),
    );

    await submit("Quiet near Bank");

    expect(trackEvent).toHaveBeenCalledWith("pub_pal_guest_trial_started");
    expect(trackEvent).toHaveBeenCalledWith(
      "pub_pal_guest_answer_completed",
      { turn: 1 },
    );
  });

  it("records only an actual in-chat mode change", async () => {
    seedTrial(0, "text");
    await renderChat();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(
      ".palGuestModeSwitch button",
    )];
    const talk = buttons.find((button) => button.textContent?.includes("Talk"));
    const text = buttons.find((button) => button.textContent?.includes("Text"));

    await act(async () => text?.click());
    expect(trackEvent).not.toHaveBeenCalledWith(
      "pub_pal_guest_mode_selected",
      expect.anything(),
    );

    await act(async () => talk?.click());
    expect(trackEvent).toHaveBeenCalledWith(
      "pub_pal_guest_mode_selected",
      { mode: "talk" },
    );
  });

  it("locks when another tab reaches the browser answer limit", async () => {
    seedTrial(4);
    await renderChat();

    seedTrial(5);
    window.dispatchEvent(new StorageEvent("storage", {
      key: TRIAL_KEY,
      newValue: window.localStorage.getItem(TRIAL_KEY),
    }));
    await settle();

    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Five guest answers complete");
  });

  it("keeps the fifth answer visible and replaces the composer with the account gate", async () => {
    seedTrial(4);
    await renderChat();
    expect(container.textContent).toContain("1 guest answer left");

    await submit("Quiet near Bank");

    expect(container.textContent).toContain("Found one Venue.");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Five guest answers complete");
    expect(storedCount()).toBe(5);
    expect(askSession).toHaveBeenCalledTimes(1);
  });

  it("does not spend an answer on a failed request", async () => {
    seedTrial(4);
    askSession.mockResolvedValueOnce({ status: "error", message: "Signal dropped." });
    await renderChat();

    await submit("Quiet near Bank");

    expect(container.textContent).toContain("Signal dropped.");
    expect(container.querySelector("form")).not.toBeNull();
    expect(container.textContent).toContain("1 guest answer left");
    expect(storedCount()).toBe(4);
  });

  it("never sends a sixth guest ask, including an automatic query", async () => {
    seedTrial(5);
    await renderChat("/pal/chat?trial=1&ask=quiet%20near%20Bank");

    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Five guest answers complete");
    expect(askSession).not.toHaveBeenCalled();
  });

  it("prefills a guest deep-link ask and waits for explicit submission", async () => {
    seedTrial(0);
    await renderChat("/pal/chat?ask=quiet%20near%20Bank");

    expect(container.querySelector<HTMLInputElement>(".palChatInput")?.value).toBe(
      "quiet near Bank",
    );
    expect(askSession).not.toHaveBeenCalled();
    expect(storedCount()).toBe(0);
  });

  it("preserves the signed-in pre-fired ask handoff", async () => {
    authState.current = { user: { id: "user-1" }, session: null, loading: false };
    await renderChat("/pal/chat?ask=quiet%20near%20Bank");

    expect(askSession).toHaveBeenCalledWith("quiet near Bank", "london");
    expect(container.textContent).toContain("Found one Venue.");
  });

  it("keeps signed-in chat unlimited even when the old guest trial is complete", async () => {
    seedTrial(5);
    authState.current = { user: { id: "user-1" }, session: null, loading: false };
    await renderChat();

    expect(container.querySelector("form")).not.toBeNull();
    expect(container.textContent).not.toContain("Five guest answers complete");
    await submit("Quiet near Bank");
    expect(askSession).toHaveBeenCalledTimes(1);
    expect(storedCount()).toBe(5);
  });

  it("uses the latest auth owner when sign-in finishes before a guest answer returns", async () => {
    seedTrial(4);
    let resolveAnswer: (value: typeof answer) => void = () => {};
    askSession.mockImplementationOnce(() => new Promise((resolve) => {
      resolveAnswer = resolve;
    }));
    await renderChat();

    const input = container.querySelector<HTMLInputElement>(".palChatInput");
    const form = container.querySelector<HTMLFormElement>("form");
    if (!input || !form) throw new Error("Pal chat composer not found");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "Quiet near Bank");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(askSession).toHaveBeenCalledTimes(1);

    authState.current = { user: { id: "user-1" }, session: null, loading: false };
    await act(async () => root?.render(createElement(PalChat)));
    await act(async () => {
      resolveAnswer(answer);
      await Promise.resolve();
    });
    await settle();

    expect(container.textContent).toContain("Found one Venue.");
    expect(storedCount()).toBe(4);
  });
});
