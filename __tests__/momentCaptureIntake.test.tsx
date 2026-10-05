// @vitest-environment jsdom

// The Moment composer at the two seams the contribution battle test found
// open (5 Sep 2026, D05 and M01), rendered with the chrome another track owns
// stubbed to nothing and the network answered by a double in the route's own
// envelope.
//
// D05: a text file named night.jpg is refused by its BYTES before it touches
// the draft, and a photo the server refuses no longer mints a second Memory,
// because the composer keeps its Memory id across a refusal about the photo.
// M01: removing two photos in one tick removes both, because the removal
// reads the current draft rather than the closure's copy of it.

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const rest = { ...props };
    delete rest.fill;
    delete rest.unoptimized;
    return createElement("img", rest);
  },
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
const auth = vi.hoisted(() => ({ owner: "host" as string | null, unresolved: false }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: auth.owner ? { id: auth.owner } : null, loading: false, accountRevision: readProviderIdentityRevision() }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({ phase: auth.unresolved ? "unresolved" : auth.owner ? "signed-in" : "signed-out", signedIn: Boolean(auth.owner), signedOut: !auth.owner && !auth.unresolved, unresolved: auth.unresolved }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => undefined }));
vi.mock("@/lib/identityNudge", () => ({ recordMomentNudgeTrigger: () => undefined }));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => false }));
vi.mock("@/lib/nativeCamera", () => ({ captureNativePhoto: async () => null }));
const loadDraft = vi.hoisted(() => vi.fn());
const saveDraft = vi.hoisted(() => vi.fn());
vi.mock("@/lib/momentDraft", async () => {
  const actual = await vi.importActual<typeof import("@/lib/momentDraft")>("@/lib/momentDraft");
  return {
    ...actual,
    loadMomentDraft: (...args: unknown[]) => loadDraft(...args),
    saveMomentDraft: (...args: unknown[]) => saveDraft(...args),
    deleteMomentDraft: async () => undefined,
  };
});

const fitMomentPhoto = vi.fn();
vi.mock("@/lib/momentPhotoFit", () => ({ fitMomentPhoto: (...args: unknown[]) => fitMomentPhoto(...args) }));

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
let answer: (call: Call) => Response = () => new Response("{}", { status: 500 });
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return answer(call);
  },
}));

import MomentCapture from "@/components/moment/MomentCapture";
import { defined } from "@/__tests__/helpers/defined";
import { createMomentDraft } from "@/lib/momentDraft";
import { readProviderIdentityRevision, setProviderIdentity, setProviderAuthState } from "@/lib/authProviderRevision";

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];

function jpegFile(name: string, size = 4096): File {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_HEAD);
  return new File([bytes], name, { type: "image/jpeg", lastModified: 1_700_000_000_000 });
}

function textFileNamedJpeg(name = "night.jpg"): File {
  return new File([new TextEncoder().encode("hello, this is text, not a photo")], name, { type: "image/jpeg" });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(rounds = 6): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(strict = false): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(strict ? createElement(StrictMode, null, createElement(MomentCapture)) : createElement(MomentCapture));
  });
  await settle();
}

function input(): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>("#moment-photo-file");
  if (!element) throw new Error("picker input missing");
  return element;
}

async function choose(...files: File[]): Promise<void> {
  const element = input();
  Object.defineProperty(element, "files", { configurable: true, value: files });
  await act(async () => {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

function status(): string {
  return container.querySelector(".momentStatus span")?.textContent ?? "";
}

function previews(): number {
  return container.querySelectorAll("figure.momentMedia").length;
}

async function save(): Promise<void> {
  const form = container.querySelector<HTMLFormElement>("form.momentComposer");
  if (!form) throw new Error("composer form missing");
  await act(async () => {
    form.requestSubmit();
  });
  await settle(10);
}

beforeEach(() => {
  auth.owner = "host";
  auth.unresolved = false;
  setProviderIdentity("supabase", "host");
  setProviderAuthState("supabase", "authenticated");
  loadDraft.mockReset().mockResolvedValue(null);
  saveDraft.mockReset().mockResolvedValue(undefined);
  calls.length = 0;
  fitMomentPhoto.mockReset();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
  let counter = 0;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => `blob:preview-${counter++}` });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => undefined });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
});

describe("what the composer admits", () => {
  it("refuses a text file named .jpg by its bytes, before it reaches the draft", async () => {
    await mount();
    await choose(textFileNamedJpeg());
    expect(previews()).toBe(0);
    expect(status()).toBe("That file is not a photo. Choose a JPEG, PNG, WebP or HEIC.");
    expect(fitMomentPhoto).not.toHaveBeenCalled();
  });

  it("keeps a real JPEG under the wire limit byte for byte", async () => {
    await mount();
    await choose(jpegFile("night.jpg"));
    expect(previews()).toBe(1);
    expect(status()).toBe("Photo added. It's still private.");
    expect(fitMomentPhoto).not.toHaveBeenCalled();
  });

  it("hands a heavy JPEG to the fit and keeps what comes back", async () => {
    // The battle test's fixture weight; the fit is doubled because jsdom has
    // no canvas, and its own ladder is __tests__/momentPhotoFit.test.ts.
    fitMomentPhoto.mockResolvedValue({ outcome: "fitted", file: jpegFile("mid.jpg", 2048), attempt: { longEdge: 2048, quality: 0.86 }, attempts: 4 });
    await mount();
    await choose(jpegFile("mid.jpg", 8_060_438));
    expect(fitMomentPhoto).toHaveBeenCalledTimes(1);
    expect(previews()).toBe(1);
    expect(status()).toBe("Photo added. It's still private.");
  });
});

describe("a refused photo does not mint a second Memory", () => {
  it("keeps the Memory id across a refusal about the photo and re-saves into it", async () => {
    let momentWrites = 0;
    answer = ({ url }) => {
      if (url === "/api/night-memories") return json({ memory: { id: "mem-1" } }, 201);
      momentWrites += 1;
      return momentWrites === 1
        ? json({ error: "Photo must be a valid, uncorrupted image.", code: "INVALID_REQUEST", retryable: false }, 400)
        : json({ moment: { id: `moment-${momentWrites}` } }, 201);
    };
    await mount();
    await choose(jpegFile("corrupt-inside.jpg"));
    await save();

    const memoryPosts = () => calls.filter((call) => call.url === "/api/night-memories");
    expect(memoryPosts()).toHaveLength(1);
    expect(status()).toBe("Photo must be a valid, uncorrupted image.");
    expect(previews()).toBe(1);

    // Remove the refused file, add a good one, save again.
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]');
    await act(async () => { remove?.click(); });
    await settle();
    await choose(jpegFile("good.jpg"));
    await save();

    expect(memoryPosts()).toHaveLength(1);
    const momentPosts = calls.filter((call) => call.url.startsWith("/api/night-memories/mem-1/moments"));
    expect(momentPosts).toHaveLength(2);
    expect(status()).toBe("Moment saved privately. You decide if it becomes a Story.");
  });

  it("drops the Memory id only when the refusal is about the Memory", async () => {
    let memoriesMinted = 0;
    answer = ({ url }) => {
      if (url === "/api/night-memories") {
        memoriesMinted += 1;
        return json({ memory: { id: `mem-${memoriesMinted}` } }, 201);
      }
      return url.includes("mem-1")
        ? json({ error: "That Memory cannot accept this Moment.", code: "NIGHT_MEMORY_REFUSED", retryable: false }, 400)
        : json({ moment: { id: "moment-1" } }, 201);
    };
    await mount();
    await choose(jpegFile("night.jpg"));
    await save();
    expect(memoriesMinted).toBe(1);
    expect(status()).toBe("That Memory cannot accept this Moment.");
    await save();
    expect(memoriesMinted).toBe(2);
    expect(status()).toBe("Moment saved privately. You decide if it becomes a Story.");
  });
});

describe("removing photos", () => {
  it("removes two photos in one tick, not just the last one", async () => {
    await mount();
    await choose(jpegFile("one.jpg"), jpegFile("two.jpg"), jpegFile("three.jpg"));
    expect(previews()).toBe(3);
    const removes = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove"]'));
    await act(async () => {
      defined(removes[0]).click();
      defined(removes[1]).click();
    });
    await settle();
    expect(previews()).toBe(1);
    expect(container.querySelector('button[aria-label="Remove three.jpg"]')).not.toBeNull();
  });
});


async function changeAccount(owner: string | null, unresolved = false): Promise<void> {
  auth.owner = owner;
  auth.unresolved = unresolved;
  if (!unresolved) setProviderIdentity("supabase", owner);
  setProviderAuthState("supabase", unresolved ? "unresolved" : owner ? "authenticated" : "signed-out");
  await act(async () => { root!.render(createElement(MomentCapture)); });
  await settle();
}

describe("Moment account ownership", () => {
  it("captures locally while Auth is unresolved and imports that guest draft after sign-in", async () => {
    let guest = { ...createMomentDraft("guest"), caption: "Guest night fixture" };
    loadDraft.mockImplementation(async (owner: string) => owner === "guest" ? guest : null);
    saveDraft.mockImplementation(async (draft: typeof guest) => { if (draft.ownerKey === "guest") guest = draft; });
    auth.owner = null;
    auth.unresolved = true;
    setProviderIdentity("supabase", null);
    setProviderAuthState("supabase", "unavailable");
    await mount();
    expect(container.querySelector<HTMLFormElement>(".momentComposer")?.hidden).toBe(false);
    expect(container.querySelector<HTMLTextAreaElement>(".momentFields textarea")?.value).toBe("Guest night fixture");
    await choose(jpegFile("guest-night.jpg"));
    expect(previews()).toBe(1);
    expect(calls).toHaveLength(0);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    await changeAccount("host");
    expect(container.querySelector<HTMLTextAreaElement>(".momentFields textarea")?.value).toBe("Guest night fixture");
    expect(previews()).toBe(1);
    expect(container.querySelector<HTMLButtonElement>(".momentSave")?.disabled).toBe(false);
  });

  it("tells a guest to sign in when Save is tapped while Auth is unavailable", async () => {
    auth.owner = null;
    auth.unresolved = true;
    setProviderIdentity("supabase", null);
    setProviderAuthState("supabase", "unavailable");
    await mount();
    await choose(jpegFile("guest-save.jpg"));
    const saveButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Save this Moment");
    await act(async () => saveButton!.click());
    await settle();
    expect(status()).toBe("Sign in to save this Moment. Your draft will stay here.");
    expect(calls).toHaveLength(0);
    expect(previews()).toBe(1);
  });

  it("restores the account's own draft instead of importing the guest draft", async () => {
    const owned = { ...createMomentDraft("host"), caption: "Owner's night fixture" };
    loadDraft.mockImplementation(async (owner: string) => owner === "host" ? owned : { ...createMomentDraft("guest"), caption: "Guest night fixture" });
    await mount();
    expect(container.querySelector<HTMLTextAreaElement>(".momentFields textarea")?.value).toBe("Owner's night fixture");
    expect(loadDraft).not.toHaveBeenCalledWith("guest");
  });

  it("restores an editable draft during StrictMode effect replay", async () => {
    await mount(true);
    await choose(jpegFile("strict-mode.jpg"));
    expect(previews()).toBe(1);
    expect(container.querySelector<HTMLButtonElement>(".momentSave")?.disabled).toBe(false);
  });
  it("does not continue a save when the old Memory body arrives under another account", async () => {
    let releaseBody!: (value: unknown) => void;
    const body = new Promise<unknown>((resolve) => { releaseBody = resolve; });
    answer = () => ({ ok: true, status: 201, json: () => body }) as Response;
    await mount();
    await choose(jpegFile("owner-photo.jpg"));
    await save();
    expect(calls).toHaveLength(1);
    await changeAccount("other");
    expect(previews()).toBe(0);
    await act(async () => { releaseBody({ memory: { id: "old-owner-memory" } }); });
    await settle();
    expect(calls).toHaveLength(1);
    expect(status()).toBe("Your draft stays on this device until you save it.");
    expect(container.querySelector(".momentSaved")).toBeNull();
  });

  it("discards a photo fit that finishes after switching accounts", async () => {
    let releaseFit!: (value: unknown) => void;
    fitMomentPhoto.mockReturnValue(new Promise((resolve) => { releaseFit = resolve; }));
    await mount();
    await choose(jpegFile("large-private.jpg", 8_060_438));
    expect(fitMomentPhoto).toHaveBeenCalledTimes(1);
    await changeAccount("other");
    await act(async () => { releaseFit({ outcome: "fitted", file: jpegFile("fitted-private.jpg"), attempts: 1 }); });
    await settle();
    expect(previews()).toBe(0);
    expect(status()).toBe("Your draft stays on this device until you save it.");
  });

  it("keeps the same account's photo through token refresh and unresolved recovery", async () => {
    await mount();
    await choose(jpegFile("same-account.jpg"));
    await changeAccount("host");
    expect(previews()).toBe(1);
    await changeAccount(null, true);
    expect(container.querySelector<HTMLFormElement>(".momentComposer")?.hidden).toBe(true);
    await changeAccount("host");
    expect(container.querySelector<HTMLFormElement>(".momentComposer")?.hidden).toBe(false);
    expect(previews()).toBe(1);
  });
});
