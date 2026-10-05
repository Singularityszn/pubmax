// @vitest-environment jsdom

import { act, createElement, Profiler, useState, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

// Synthetic Auth and transport boundaries. The composer, draft hydration,
// account request guard and Pint Drop hook remain real. This is UI lifecycle
// proof, not real GoTrue authentication or durable server persistence.
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/authClient", () => ({
  getAccessToken: vi.fn(async () => `fixture-token-${activeAccount?.id}`),
}));

import { AuthContext, useAuth } from "@/components/auth/authContext";
import PintDropComposer from "@/components/map/PintDropComposer";
import PintDropsList from "@/components/map/inspector/PintDropsList";
import type { Venue } from "@/lib/venues";
import { usePintDrops } from "@/components/map/usePintDrops";
import { publishAuthActionState } from "@/lib/authedFetch";
import { markProviderSignOut, readProviderAccountRevision, setProviderAuthState, setProviderIdentity } from "@/lib/authProviderRevision";
import { SPILL_EXTRAS_TOGGLE_LABEL } from "@/lib/spill";
import { writeActiveRoundCode } from "@/lib/activeRound";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
import { bindDeviceAccountOwner, releaseDeviceAccountOwner, emitDeviceIdentityChanged } from "@/lib/deviceAccountIdentity";
import { readOptimisticSpills } from "@/lib/optimisticSpillPost";
import { pintDropAccountDraftOwner, readPintDropDraft } from "@/lib/pintDropDraft";
import type { SpeechRecognitionLike } from "@/lib/pintDropSpeech";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VENUE_ID = "venue-test1";
const NOTE = "Account A's private draft story";
const A = { id: "fixture-account-a", handle: "fixture_a" };
const B = { id: "fixture-account-b", handle: "fixture_b" };
const SERVER_NOTE = "A public server-backed Pint Drop";
const serverDrop = {
  id: "fixture-server-drop", venueId: VENUE_ID, handle: "fixture_public", drink: "Lager",
  priceGbp: null, passedDownNote: SERVER_NOTE, era: "", vibeTags: [],
  provenance: "user", status: "visible", visibility: "public", createdAt: "2026-10-04T18:00:00Z",
};
let activeAccount: typeof A | null;
let root: Root;
let container: HTMLDivElement;
let postHandler: (init: RequestInit) => Promise<Response>;
let roundHandler: ((init: RequestInit) => Promise<Response>) | null;
let roundRequests: RequestInit[];
let posts: RequestInit[];
let venueReads: string[];
let tokenVersion: number;
let paints: { accountId: string | null; note: string; photos: number; pendingNotes: string }[];
let createdPhotoUrls: string[];
let revokedPhotoUrls: string[];
let showDropList = false;

function ComposerHost() {
  const state = usePintDrops("london");
  const [heldSubmit, setHeldSubmit] = useState<(() => Promise<void> | void) | null>(null);
  const [heldReport, setHeldReport] = useState<(() => Promise<void> | void) | null>(null);
  return createElement("div", null,
    createElement("button", {
      onClick: () => {
        const own = state.dropsByVenueId.get(VENUE_ID)?.find((drop) => drop.handle === activeAccount?.handle);
        if (own) setHeldReport(() => () => state.reportDrop(VENUE_ID, own.id));
      },
    }, "Hold own report"),
    createElement("button", { onClick: () => { void heldReport?.(); } }, "Send held report"),
    createElement("button", {
      onClick: () => {
        setHeldSubmit(() => () => state.submitDrop({ preventDefault() {} } as FormEvent, VENUE_ID));
      },
    }, "Hold current submit"),
    createElement("button", { onClick: () => { void heldSubmit?.(); } }, "Send held submit"),
    createElement("output", { "data-testid": "drop-result" }, state.dropMsg?.text ?? ""),
    createElement("output", { "data-testid": "drop-links" }, state.dropMsg?.links?.map((link) => link.label).join(" | ") ?? ""),
    createElement("output", { "data-testid": "drop-notes" },
      [...state.dropsByVenueId.values()].flat().map((drop) => drop.passedDownNote).join(" | ")),
    createElement("output", { "data-testid": "drop-states" },
      [...state.dropsByVenueId.values()].flat().map((drop) => drop.optimistic?.state ?? "saved").join(" | ")),
    createElement(PintDropComposer, { venueId: VENUE_ID, venueName: "The Fixture Arms", state }),
    showDropList ? createElement("section", { "data-testid": "drop-list" }, createElement(PintDropsList, {
      venue: { id: VENUE_ID, name: "The Fixture Arms" } as Venue,
      drops: state.dropsByVenueId.get(VENUE_ID) ?? [],
      lastTrainDecision: null,
      reportDrop: state.reportDrop,
    })) : null,
  );
}

function AuthFixture({ resolved, sessionAvailable }: { resolved: boolean; sessionAvailable: boolean }) {
  const fallback = useAuth();
  const value = {
    ...fallback,
    configured: true,
    user: activeAccount && sessionAvailable ? { id: activeAccount.id } : null,
    session: activeAccount && sessionAvailable ? { user: { id: activeAccount.id }, access_token: `synthetic-session-${tokenVersion}` } : null,
    handle: resolved ? activeAccount?.handle ?? null : null,
    loading: !resolved,
    identityResolved: resolved,
    providerAuthState: resolved ? activeAccount ? "authenticated" : "signed-out" : "unavailable",
    supabaseAuthState: resolved ? activeAccount ? "authenticated" : "signed-out" : "unavailable",
    accountRevision: readProviderAccountRevision(),
    getCurrentUserId: () => activeAccount?.id ?? null,
  } as NonNullable<React.ContextType<typeof AuthContext>>;
  return createElement(AuthContext.Provider, { value }, createElement(ComposerHost));
}

async function renderAccount(account: typeof A | null, resolved = true, sessionAvailable = true, transientSignedOut = false) {
  activeAccount = account;
  // AuthProvider binds on a real session. Only explicit signOut releases it;
  // a failed-refresh SIGNED_OUT retains the owner for silent recovery.
  if (account) bindDeviceAccountOwner(account.id, safeLocalStorage(), safeSessionStorage());
  else if (!transientSignedOut) {
    markProviderSignOut("supabase");
    releaseDeviceAccountOwner(safeLocalStorage(), safeSessionStorage());
    emitDeviceIdentityChanged();
  }
  // Mirrors the provider's public account boundary, not token rotation.
  setProviderIdentity("supabase", account?.id ?? null);
  setProviderAuthState("supabase", resolved ? account ? "authenticated" : "signed-out" : "unavailable");
  publishAuthActionState({ status: resolved ? account ? "signed-in" : "signed-out" : "unknown", identityResolved: resolved });
  await act(async () => root.render(createElement(Profiler, {
    id: "mounted-composer",
    onRender: () => paints.push({
      accountId: activeAccount?.id ?? null,
      note: container.querySelector("textarea")?.value ?? "",
      photos: container.querySelectorAll('img[src^="blob:fixture-"]').length,
      pendingNotes: container.querySelector('[data-testid="drop-notes"]')?.textContent ?? "",
    }),
  }, createElement(AuthFixture, { resolved, sessionAvailable }))));
}

function control(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
  if (!button) throw new Error(`Missing control: ${text}`);
  return button;
}

function photoPreviewUrl(alt: string): string {
  const image = container.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);
  if (!image) throw new Error(`Missing photo preview: ${alt}`);
  return image.getAttribute("src") ?? "";
}

async function click(text: string) {
  await act(async () => control(text).click());
}

async function fill(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function draft(withPhotos = false) {
  await click(SPILL_EXTRAS_TOGGLE_LABEL);
  await fill(container.querySelector("textarea")!, NOTE);
  expect(container.querySelector("textarea")?.value).toBe(NOTE);
  if (!withPhotos) return;
  const price = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
  await fill(price, "5.75");
  const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  expect(inputs).toHaveLength(3);
  for (const [index, input] of inputs.entries()) {
    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [new File(["synthetic-jpeg"], `account-a-${index}.jpg`, { type: "image/jpeg" })] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  expect(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(4);
  expect(new Set([...container.querySelectorAll('img[src^="blob:fixture-"]')].map((image) => image.getAttribute("src"))).size).toBe(3);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  posts = [];
  venueReads = [];
  roundHandler = null;
  roundRequests = [];
  tokenVersion = 1;
  paints = [];
  createdPhotoUrls = [];
  revokedPhotoUrls = [];
  let urlIndex = 0;
  vi.stubGlobal("URL", URL);
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:fixture-${++urlIndex}`;
    createdPhotoUrls.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revokedPhotoUrls.push(url);
  });
  postHandler = async () => new Response(JSON.stringify({ error: { message: "Fixture refused this drop" } }), { status: 503 });
  showDropList = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (String(input).startsWith("/api/pint-drops") && (init.method ?? "GET") === "GET") {
      if (String(input).includes("venueId=")) venueReads.push(String(input));
      return new Response(JSON.stringify({ drops: [serverDrop] }));
    }
    if (String(input) === "/api/pint-drops" && init.method === "POST") {
      posts.push(init);
      return postHandler(init);
    }
    if (String(input) === "/api/cheap-pint-ping" && init.method === "POST") return new Response(JSON.stringify({ canPrompt: false }));
    if (String(input) === "/api/rounds/BCDFGH" && init.method === "POST" && roundHandler) {
      roundRequests.push(init);
      return roundHandler(init);
    }
    throw new Error(`Unexpected fixture request: ${String(input)}`);
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  activeAccount = null;
  setProviderIdentity("supabase", null);
  publishAuthActionState({ status: "signed-out", identityResolved: true });
  setProviderAuthState("supabase", "signed-out");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("mounted Pint Drop account draft isolation", () => {
  describe("dictation ownership", () => {
    const TRANSCRIPT = "Account A's unfinished voice transcript";
    const REPLACEMENT_NOTE = "The replacement owner's typed story";
    let recognitions: Recognition[];

    class Recognition implements SpeechRecognitionLike {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult: SpeechRecognitionLike["onresult"] = null;
      onerror: SpeechRecognitionLike["onerror"] = null;
      onend: SpeechRecognitionLike["onend"] = null;
      start = vi.fn();
      stop = vi.fn();

      constructor() {
        recognitions.push(this);
      }
    }

    beforeEach(() => {
      recognitions = [];
      vi.stubGlobal("SpeechRecognition", Recognition);
    });

    async function typeStory(note: string) {
      if (!container.querySelector("textarea")) await click(SPILL_EXTRAS_TOGGLE_LABEL);
      await fill(container.querySelector("textarea")!, note);
      expect(container.querySelector("textarea")?.value).toBe(note);
    }

    async function startDictation() {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Add note by voice"]');
      expect(button).not.toBeNull();
      await act(async () => button!.click());
      expect(recognitions).toHaveLength(1);
      const recognition = defined(recognitions[0], "started recognition");
      expect(recognition.start).toHaveBeenCalledOnce();
      const result = recognition.onresult;
      expect(result).not.toBeNull();
      return {
        recognition,
        complete: () => result!({ resultIndex: 0, results: [{ 0: { transcript: TRANSCRIPT }, isFinal: true }] }),
      };
    }

    it.each(["account switch", "confirmed sign-out"] as const)(
      "rejects A's final dictation result after %s and replacement draft hydration",
      async (boundary) => {
        await renderAccount(B);
        await typeStory(REPLACEMENT_NOTE);
        await renderAccount(A);
        await typeStory(NOTE);
        const { recognition, complete } = await startDictation();

        const replacement = boundary === "account switch" ? B : null;
        const storageOwner = replacement ? pintDropAccountDraftOwner(replacement.id) : "signed-out";
        await renderAccount(replacement);
        if (!replacement) await typeStory(REPLACEMENT_NOTE);
        expect(container.querySelector("textarea")?.value).toBe(REPLACEMENT_NOTE);
        expect(readPintDropDraft(sessionStorage, VENUE_ID, storageOwner)?.form.note).toBe(REPLACEMENT_NOTE);
        expect(recognition.stop).toHaveBeenCalledOnce();

        await act(async () => complete());

        expect.soft(container.querySelector("textarea")?.value).toBe(REPLACEMENT_NOTE);
        expect.soft(container.textContent).not.toContain(NOTE);
        expect.soft(container.textContent).not.toContain(TRANSCRIPT);
        const saved = readPintDropDraft(sessionStorage, VENUE_ID, storageOwner);
        expect.soft(saved?.form.note).toBe(REPLACEMENT_NOTE);
        expect.soft(JSON.stringify(saved)).not.toContain(NOTE);
        expect.soft(JSON.stringify(saved)).not.toContain(TRANSCRIPT);
        await renderAccount(A);
        await renderAccount(replacement);
        expect(container.querySelector("textarea")?.value).toBe(REPLACEMENT_NOTE);
      },
    );

    it("rejects dictation stopped while the retained private draft is hidden", async () => {
      await renderAccount(A);
      await typeStory(NOTE);
      const { recognition, complete } = await startDictation();
      recognition.stop.mockImplementation(complete);

      await renderAccount(A, false, false);
      expect(recognition.stop).toHaveBeenCalledOnce();
      expect(container.querySelector("textarea")).toBeNull();
      await renderAccount(A);
      expect(container.querySelector("textarea")?.value).toBe(NOTE);
      expect(readPintDropDraft(sessionStorage, VENUE_ID, pintDropAccountDraftOwner(A.id))?.form.note).toBe(NOTE);
    });

    it("accepts the same owner's final dictation result after explicit Stop and token refresh", async () => {
      await renderAccount(A);
      await typeStory(NOTE);
      const { recognition, complete } = await startDictation();
      tokenVersion += 1;
      await renderAccount(A);
      const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop voice note"]');
      expect(stop).not.toBeNull();
      await act(async () => stop!.click());
      expect(recognition.stop).toHaveBeenCalledOnce();
      await act(async () => complete());

      expect(container.querySelector("textarea")?.value).toBe(`${NOTE} ${TRANSCRIPT}`);
      expect(readPintDropDraft(sessionStorage, VENUE_ID, pintDropAccountDraftOwner(A.id))?.form.note).toBe(NOTE);
      expect(container.querySelector('button[aria-label="Add note by voice"]')).not.toBeNull();
    });
  });

  it("keeps each existing photo URL live as other slots are added", async () => {
    await renderAccount(A);
    await draft(true);

    expect(createdPhotoUrls).toHaveLength(3);
    expect(new Set(createdPhotoUrls).size).toBe(3);
    expect(revokedPhotoUrls).toEqual([]);
  });

  it("revokes only the removed photo URL and keeps sibling previews live", async () => {
    await renderAccount(A);
    await draft(true);

    const pintUrl = photoPreviewUrl("Preview of your pint photo");
    const siblingUrls = createdPhotoUrls.filter((url) => url !== pintUrl);
    const removePint = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove pint photo"]',
    );
    expect(removePint).not.toBeNull();

    await act(async () => removePint!.click());

    expect(revokedPhotoUrls).toEqual([pintUrl]);
    expect(siblingUrls.every((url) => !revokedPhotoUrls.includes(url))).toBe(true);
  });

  it("replaces a removed pint photo without revoking retained sibling URLs", async () => {
    await renderAccount(A);
    await draft(true);

    const oldPintUrl = photoPreviewUrl("Preview of your pint photo");
    const siblingUrls = createdPhotoUrls.filter((url) => url !== oldPintUrl);
    const removePint = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove pint photo"]',
    );
    expect(removePint).not.toBeNull();
    await act(async () => removePint!.click());

    const pintInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Snap the pour: snap or upload a pint photo"], input[aria-label="Your pint: Snap or upload"]',
    );
    expect(pintInput).not.toBeNull();
    await act(async () => {
      Object.defineProperty(pintInput!, "files", {
        configurable: true,
        value: [new File(["synthetic-jpeg"], "replacement-pint.jpg", { type: "image/jpeg" })],
      });
      pintInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const replacementPintUrl = photoPreviewUrl("Preview of your pint photo");
    expect(replacementPintUrl).not.toBe(oldPintUrl);
    expect(revokedPhotoUrls).toEqual([oldPintUrl]);
    expect(siblingUrls.every((url) => !revokedPhotoUrls.includes(url))).toBe(true);
  });

  it.each(["account switch", "explicit sign-out", "unmount"] as const)(
    "releases each held photo URL exactly once on %s",
    async (boundary) => {
      await renderAccount(A);
      await draft(true);

      const heldUrls = [...createdPhotoUrls];
      expect(heldUrls).toHaveLength(3);
      expect(revokedPhotoUrls).toEqual([]);

      if (boundary === "account switch") {
        await renderAccount(B);
      } else if (boundary === "explicit sign-out") {
        await renderAccount(null);
      } else {
        await act(async () => root.unmount());
        root = createRoot(container);
      }

      expect([...revokedPhotoUrls].sort()).toEqual([...heldUrls].sort());
      expect(revokedPhotoUrls).toHaveLength(heldUrls.length);
    },
  );

  it("does not show A's story or any selected photo under B at the same venue", async () => {
    await renderAccount(A);
    await draft(true);
    await renderAccount(B);
    // React's public commit observer reads rendered DOM before passive draft
    // effects. A later clearing effect cannot hide the first B paint.
    const firstBPaint = paints.find((paint) => paint.accountId === B.id)!;
    expect.soft(firstBPaint.note).not.toContain(NOTE);
    expect.soft(firstBPaint.photos).toBe(0);
    expect(container.querySelector(".spillPostingAs")?.textContent).toContain("fixture_b");
    expect.soft(container.querySelector("textarea")?.value ?? "").not.toContain(NOTE);
    expect.soft(container.textContent).not.toContain(NOTE);
    expect.soft(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(0);
    expect.soft(container.querySelector('[data-testid="spill-receipt-step"]')?.textContent ?? "").not.toContain("Bill ready");
  });

  it("does not spend B's request authority from A's held submit callback", async () => {
    await renderAccount(A);
    await draft();
    await click("Hold current submit");
    await renderAccount(B);
    await click("Send held submit");
    expect(posts.map((post) => ({
      authorization: new Headers(post.headers).get("authorization"),
      note: (post.body as FormData).get("passedDownNote"),
    }))).toEqual([]);
  });

  it("preserves the draft and photos through token refresh and unresolved recovery of the same account", async () => {
    await renderAccount(A);
    await draft(true);
    tokenVersion += 1;
    await renderAccount(A);
    expect(container.querySelector("textarea")?.value).toBe(NOTE);
    expect(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(4);
    await renderAccount(A, false, false);
    expect.soft(container.querySelector("textarea")).toBeNull();
    expect.soft(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(0);
    expect.soft(container.textContent).not.toContain(NOTE);
    await renderAccount(A);
    expect(container.querySelector("textarea")?.value).toBe(NOTE);
    expect(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="spill-receipt-step"]')?.textContent).toContain("Bill ready");
  });

  it("preserves the mounted draft and photos through a transient failed-refresh SIGNED_OUT", async () => {
    await renderAccount(A);
    await draft(true);
    await renderAccount(null, true, true, true);
    expect.soft(container.querySelector("textarea")).toBeNull();
    expect.soft(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(0);
    expect.soft(container.textContent).not.toContain(NOTE);
    expect.soft(container.querySelector('a[href*="login"]')?.getAttribute("href")).not.toContain("5.75");
    await renderAccount(A);
    expect.soft(container.querySelector("textarea")?.value).toBe(NOTE);
    expect.soft(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(4);
  });

  it.each([true, false])("distinguishes transient=%s sign-out when device owner storage is blocked", async (transient) => {
    await renderAccount(A);
    await draft(true);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("Storage blocked"); });
    await renderAccount(null, true, true, transient);
    expect.soft(container.querySelector("textarea")?.value ?? "").not.toContain(NOTE);
    expect.soft(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(0);
    await renderAccount(A);
    if (transient) {
      expect.soft(container.querySelector("textarea")?.value).toBe(NOTE);
      expect.soft(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(4);
    } else {
      expect.soft(container.querySelector("textarea")?.value ?? "").not.toContain(NOTE);
      expect.soft(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(0);
    }
  });

  it("clears the private mounted draft and photos after confirmed sign-out", async () => {
    await renderAccount(A);
    await draft(true);
    await renderAccount(null);
    expect.soft(container.querySelector("textarea")?.value ?? "").not.toContain(NOTE);
    expect.soft(container.textContent).not.toContain(NOTE);
    expect.soft(container.querySelectorAll('img[src^="blob:fixture-"]')).toHaveLength(0);
    await renderAccount(A);
    expect(container.querySelector("textarea")?.value ?? "").not.toContain(NOTE);
  });

  it.each([
    ["Family Table", "legacy"],
    ["Friends", "friends"],
  ])("does not keep an accepted %s drop in B's rendered lane", async (choice, visibility) => {
    postHandler = async (init) => new Response(JSON.stringify({ drop: {
      ...serverDrop, id: "fixture-accepted-family-drop", handle: A.handle,
      passedDownNote: NOTE, visibility: (init.body as FormData).get("visibility"),
    } }), { status: 201 });
    await renderAccount(A);
    await draft();
    await click(choice);
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect((defined(posts[0], "submitted Pint Drop request").body as FormData).get("visibility")).toBe(visibility);
    expect(container.querySelector('[data-testid="drop-result"]')?.textContent).toContain("Your Pint Drop is live");
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).toContain(NOTE);
    await renderAccount(null, true, true, true);
    expect.soft(container.querySelector('[data-testid="drop-notes"]')?.textContent).not.toContain(NOTE);
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).toContain(SERVER_NOTE);
    await renderAccount(A);
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).toContain(NOTE);
    await renderAccount(B);
    expect.soft(paints.find((paint) => paint.accountId === B.id)?.pendingNotes ?? "").not.toContain(NOTE);
    expect.soft(container.querySelector('[data-testid="drop-notes"]')?.textContent).not.toContain(NOTE);
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).toContain(SERVER_NOTE);
  });

  it("restores only the same account's saved story when accounts switch at one venue", async () => {
    await renderAccount(A);
    await draft();
    await renderAccount(B);
    await click(SPILL_EXTRAS_TOGGLE_LABEL);
    await fill(container.querySelector("textarea")!, "Account B's own story");
    await renderAccount(A);
    expect(container.querySelector("textarea")?.value).toBe(NOTE);
    await renderAccount(B);
    expect(container.querySelector("textarea")?.value).toBe("Account B's own story");
  });

  it("allows the same account's held submission after token refresh and recovery", async () => {
    await renderAccount(A);
    await draft();
    await click("Hold current submit");
    tokenVersion += 1;
    await renderAccount(A, false);
    await renderAccount(A);
    await click("Send held submit");
    expect(posts).toHaveLength(1);
    expect((defined(posts[0], "submitted Pint Drop request").body as FormData).get("passedDownNote")).toBe(NOTE);
    expect(container.querySelector('[data-testid="drop-result"]')?.textContent).toBe("Fixture refused this drop");
  });

  it("does not publish a late successful body into B's lane", async () => {
    let releaseBody!: () => void;
    postHandler = async () => new Response(new ReadableStream({
      start(controller) {
        // Model already-buffered response bytes becoming readable after the
        // account boundary. The caller must guard even this completion race.
        releaseBody = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ drop: {
            ...serverDrop, id: "fixture-late-saved-drop", passedDownNote: NOTE,
          } })));
          controller.close();
        };
      },
    }), { status: 201 });
    await renderAccount(A);
    await draft();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(posts).toHaveLength(1);
    await renderAccount(B);
    await act(async () => releaseBody());
    expect(container.querySelector('[data-testid="drop-result"]')?.textContent).toBe("");
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).not.toContain(NOTE);
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).toContain(SERVER_NOTE);
  });

  it("does not write A's receipt into B after a delayed Round append completes", async () => {
    let finishAppend!: () => void;
    writeActiveRoundCode("BCDFGH");
    postHandler = async () => new Response(JSON.stringify({ drop: {
      ...serverDrop, id: "fixture-round-saved-drop", passedDownNote: NOTE,
    } }), { status: 201 });
    roundHandler = async (init) => JSON.parse(String(init.body)).action === "join"
      ? new Response("{}")
      : new Promise<Response>((resolve) => { finishAppend = () => resolve(new Response("{}")); });
    await renderAccount(A);
    await draft();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(roundRequests).toHaveLength(2));
    await renderAccount(B);
    await act(async () => finishAppend());
    expect(container.querySelector('[data-testid="drop-result"]')?.textContent).toBe("");
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).toContain(SERVER_NOTE);
  });

  it.each([200, 503])("does not publish A's body-read abort error into B's composer after HTTP %i headers", async (status) => {
    let bodyAborted = false;
    postHandler = async (init) => new Response(new ReadableStream({
      start(controller) {
        init.signal!.addEventListener("abort", () => {
          bodyAborted = true;
          controller.error(init.signal!.reason);
        }, { once: true });
      },
    }), { status, headers: { "content-type": "application/json" } });
    await renderAccount(A);
    await draft();
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(posts).toHaveLength(1);
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).toContain(NOTE);
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).toContain(SERVER_NOTE);
    await renderAccount(B);
    expect(bodyAborted).toBe(true);
    expect.soft(paints.find((paint) => paint.accountId === B.id)?.pendingNotes ?? "").not.toContain(NOTE);
    expect.soft(container.querySelector('[data-testid="drop-result"]')?.textContent).toBe("");
    expect.soft(container.querySelector('[data-testid="drop-notes"]')?.textContent).not.toContain(NOTE);
    expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).toContain(SERVER_NOTE);
  });

  describe("reporting an accepted friends-only Pint Drop", () => {
    const FRIENDS_DROP_ID = "fixture-accepted-friends-drop";
    const NOTE_B = "B's own public drop";
    const RECEIPT_B = "Cheers. Your Pint Drop is live.";
    const privatePhoto = () => container.querySelector(`img[alt="Pint at The Fixture Arms shared by ${A.handle}"]`);
    const list = () => container.querySelector('[data-testid="drop-list"]')?.textContent ?? "";
    const result = () => container.querySelector('[data-testid="drop-result"]')?.textContent ?? "";
    const reports = () => posts.filter((init) => typeof init.body === "string" && JSON.parse(init.body).action === "report");
    let reportAnswer: () => Promise<Response>;

    function acceptedDrop(account: typeof A, id: string, note: string, visibility: string, photo: string | null) {
      return new Response(JSON.stringify({ drop: {
        ...serverDrop, id, handle: account.handle, passedDownNote: note, visibility, priceGbp: 5.75,
        pintPhotoUrl: photo,
      } }), { status: 201 });
    }

    /** A submits a friends-only drop with a pint photo through the real composer; the server accepts it. */
    async function acceptAFriendsDrop() {
      showDropList = true;
      postHandler = async (init) => {
        if (typeof init.body === "string" && JSON.parse(init.body).action === "report") return reportAnswer();
        return activeAccount?.id === A.id
          ? acceptedDrop(A, FRIENDS_DROP_ID, NOTE, "friends", "https://pubmaxxing.com/photos/a-private-pint.jpg")
          : acceptedDrop(B, "fixture-b-public-drop", NOTE_B, "public", null);
      };
      await renderAccount(A);
      await draft(true);
      const friends = [...container.querySelectorAll<HTMLButtonElement>('button[role="radio"]')]
        .find((button) => button.textContent?.trim() === "Friends");
      await act(async () => friends!.click());
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      await vi.waitFor(() => expect(list()).toContain(NOTE));
      expect(privatePhoto()).not.toBeNull();
      expect(list()).toContain(SERVER_NOTE);
    }

    async function reportOwnDrop() {
      await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="Report Pint Drop by ${A.handle}"]`)!.click());
      expect(reports()).toHaveLength(1);
      expect(list()).not.toContain(NOTE);
    }

    /** B signs in, logs a public drop and holds its receipt. */
    async function bLogsADrop() {
      await renderAccount(B);
      if (!container.querySelector("textarea")) await click(SPILL_EXTRAS_TOGGLE_LABEL);
      await fill(container.querySelector("textarea")!, NOTE_B);
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      await vi.waitFor(() => expect(result()).toBe(RECEIPT_B));
      expect(list()).toContain(NOTE_B);
    }

    function delayedJson(status: number, body: unknown) {
      let release!: () => void;
      const response = new Response(new ReadableStream({
        start(controller) {
          release = () => {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
            controller.close();
          };
        },
      }), { status, headers: { "content-type": "application/json" } });
      return { response, release: () => release() };
    }

    it.each([
      ["its request fails after B signed in", "transport"],
      ["it is refused and its body arrives after B signed in", "refused"],
      ["it succeeds and its body arrives after B signed in", "accepted"],
    ] as const)("keeps A's private note, photo and report outcome out of B's lane when %s", async (_label, outcome) => {
      let settle!: () => void;
      reportAnswer = () => {
        if (outcome === "transport") {
          return new Promise<Response>((_resolve, reject) => { settle = () => reject(new TypeError("Failed to fetch")); });
        }
        const delayed = delayedJson(outcome === "refused" ? 503 : 200, outcome === "refused"
          ? { error: { message: "Fixture refused this report" } }
          : { ok: true });
        settle = delayed.release;
        return Promise.resolve(delayed.response);
      };
      await acceptAFriendsDrop();
      await reportOwnDrop();
      await bLogsADrop();

      await act(async () => settle());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      expect(list()).not.toContain(NOTE);
      expect(privatePhoto()).toBeNull();
      expect(list()).toContain(NOTE_B);
      expect(list()).toContain(SERVER_NOTE);
      expect(result()).toBe(RECEIPT_B);
    });

    it("does not send A's held report from B's session", async () => {
      reportAnswer = async () => new Response(JSON.stringify({ ok: true }));
      await acceptAFriendsDrop();
      await click("Hold own report");
      await bLogsADrop();
      await click("Send held report");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      expect(reports()).toHaveLength(0);
      expect(list()).toContain(NOTE_B);
      expect(result()).toBe(RECEIPT_B);
    });

    it("puts the private drop and its photo back for A when A's own report fails", async () => {
      reportAnswer = async () => { throw new TypeError("Failed to fetch"); };
      await acceptAFriendsDrop();
      await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="Report Pint Drop by ${A.handle}"]`)!.click());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      expect(list()).toContain(NOTE);
      expect(privatePhoto()).not.toBeNull();
      expect(result()).toBe("Could not report that Pint Drop. Try again.");
    });

    it("puts a public drop A reported back under B when the report fails", async () => {
      let settle!: () => void;
      reportAnswer = () => new Promise<Response>((_resolve, reject) => { settle = () => reject(new TypeError("Failed to fetch")); });
      await acceptAFriendsDrop();
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Report Pint Drop by fixture_public"]')!.click());
      expect(list()).not.toContain(SERVER_NOTE);
      await bLogsADrop();
      await act(async () => settle());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

      expect(list()).toContain(SERVER_NOTE);
      expect(list()).not.toContain(NOTE);
      expect(result()).toBe(RECEIPT_B);
    });
  });

  it("lets a guest reach the price step and sign-in door while the Auth SDK is unavailable", async () => {
    await renderAccount(null, false, true, true);
    expect(container.textContent).not.toContain("Loading saved Pint Drop draft");
    const price = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
    expect(price).not.toBeNull();
    await fill(price!, "4.80");
    expect(container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe("4.80");
    const door = [...container.querySelectorAll("a")].find((link) => link.textContent?.trim() === "Sign in to post");
    expect(door?.getAttribute("href")).toContain("/login?mode=signin");
  });

  describe("an in-flight submit aborted by the account boundary", () => {
    beforeEach(() => {
      postHandler = (init) => new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
    });

    async function submitPending() {
      await renderAccount(A);
      await draft();
      await act(async () => {
        container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(posts).toHaveLength(1);
      expect(container.querySelector('[data-testid="drop-states"]')?.textContent).toContain("pending");
      expect(readOptimisticSpills(localStorage).map((entry) => entry.drop.optimistic?.state)).toEqual(["pending"]);
    }

    it("offers the same account a retry after a failed-refresh SIGNED_OUT", async () => {
      await submitPending();
      await renderAccount(null, true, true, true);
      expect.soft(container.querySelector('[data-testid="drop-result"]')?.textContent).toBe("");
      await renderAccount(A);
      expect(container.querySelector('[data-testid="drop-states"]')?.textContent).toContain("failed");
      expect(container.querySelector('[data-testid="drop-states"]')?.textContent).not.toContain("pending");
      expect(container.querySelector('[data-testid="drop-result"]')?.textContent).toBe("Network or storage error. Try again.");
      expect(readOptimisticSpills(localStorage).map((entry) => entry.drop.optimistic?.state)).toEqual(["failed"]);
    });

    it("leaves none of A's pending work in B's lane, feed storage or composer", async () => {
      await submitPending();
      await renderAccount(B);
      expect(readOptimisticSpills(localStorage)).toEqual([]);
      expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).not.toContain(NOTE);
      expect(container.querySelector('[data-testid="drop-result"]')?.textContent).toBe("");
    });

    it("leaves none of A's pending work after an explicit sign-out", async () => {
      await submitPending();
      await renderAccount(null);
      expect(readOptimisticSpills(localStorage)).toEqual([]);
      expect(container.querySelector('[data-testid="drop-notes"]')?.textContent).not.toContain(NOTE);
      expect(container.querySelector('[data-testid="drop-result"]')?.textContent).toBe("");
    });
  });

  describe("an accepted drop settling after a delayed Round append", () => {
    let finishAppend: () => void;

    beforeEach(() => {
      writeActiveRoundCode("BCDFGH");
      postHandler = async () => new Response(JSON.stringify({
        drop: { ...serverDrop, id: "fixture-round-saved-drop", handle: A.handle, passedDownNote: NOTE },
        confirmationOutcome: {
          status: "confirmed",
          confirmation: { confirmationId: "fixture-confirmation", confirmedAt: "2026-10-04T18:05:00Z", basis: "second_reporter" },
          dropIds: ["fixture-round-saved-drop"],
        },
      }), { status: 201 });
      roundHandler = async (init) => JSON.parse(String(init.body)).action === "join"
        ? new Response("{}")
        : new Promise<Response>((resolve) => { finishAppend = () => resolve(new Response("{}")); });
    });

    async function submitAndHoldAppend() {
      await renderAccount(A);
      await draft();
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      await vi.waitFor(() => expect(roundRequests).toHaveLength(2));
    }

    it("gives the same account its receipt, Round links and minted lane re-read after a failed-refresh blip", async () => {
      await submitAndHoldAppend();
      expect(venueReads).toEqual([]);
      await renderAccount(null, true, true, true);
      await renderAccount(A);
      await act(async () => finishAppend());
      await vi.waitFor(() => expect(container.querySelector('[data-testid="drop-result"]')?.textContent).toContain("Cheers. Added to your night."));
      expect(container.querySelector('[data-testid="drop-links"]')?.textContent).toBe("Open Social | Bar tab | Your profile");
      expect(venueReads).toEqual([`/api/pint-drops?venueId=${VENUE_ID}`]);
    });

    it.each([
      ["another account", async () => renderAccount(B)],
      ["an old visit of the same account", async () => { await renderAccount(B); await renderAccount(A); }],
      ["an explicit sign-out", async () => renderAccount(null)],
    ])("withholds the receipt and re-read after %s", async (_label, boundary) => {
      await submitAndHoldAppend();
      await boundary();
      await act(async () => finishAppend());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(container.querySelector('[data-testid="drop-result"]')?.textContent).toBe("");
      expect(container.querySelector('[data-testid="drop-links"]')?.textContent).toBe("");
      expect(venueReads).toEqual([]);
    });
  });
});
