// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mounted = vi.hoisted(() => ({
  owner: "account-a",
  replace: vi.fn(),
  calls: [] as Array<{ url: string; init: RequestInit }>,
  pending: [] as Array<(response: Response) => void>,
}));

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mounted.replace }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement("a", { href }, children),
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
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: mounted.owner }, loading: false }) }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ unresolved: false }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/identityNudge", () => ({ recordMomentNudgeTrigger: () => {} }));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => false }));
vi.mock("@/lib/nativeCamera", () => ({ captureNativePhoto: async () => null }));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: async (url: string, init: RequestInit) => {
    mounted.calls.push({ url, init });
    if (url === "/api/night-memories") return new Response(JSON.stringify({ memory: { id: "memory-mounted" } }), { status: 201 });
    return new Promise<Response>((resolve) => { mounted.pending.push(resolve); });
  },
}));

import MomentCapture from "@/components/moment/MomentCapture";
import { setProviderAuthState, setProviderIdentity } from "@/lib/authProviderRevision";

import {
  applyMomentSaveReceipt,
  createMomentDraft,
  deleteMomentDraft,
  loadMomentDraft,
  momentMediaKey,
  momentSubmissionMetadata,
  saveMomentDraft,
  settleMomentDraftProgress,
  type MomentDraftV1,
  type MomentMediaDraft,
  type MomentSaveReceipt,
} from "@/lib/momentDraft";

// The real draft store. jsdom has no IndexedDB, so every call here takes the
// store's own localStorage fallback lane - the lane a browser uses when
// IndexedDB is unavailable, which keeps metadata and no photo bytes. The
// IndexedDB lane itself is not executed here.

const OWNER = "account-a";

function photo(id: string): MomentMediaDraft {
  return {
    id, type: "image", name: `${id}.jpg`, mimeType: "image/jpeg", size: 4, blob: new Blob(["jpeg"]),
    objectUrl: null, width: null, height: null, focalX: 0.5, focalY: 0.5, alt: "",
  };
}

function captionDraft(owner = OWNER): MomentDraftV1 {
  return { ...createMomentDraft(owner), caption: "A night worth keeping", revision: 1 };
}

function confirmedReceipt(draft: MomentDraftV1): MomentSaveReceipt {
  return {
    uploadedMedia: draft.media.map((item) => ({
      ...momentSubmissionMetadata(draft, true), key: momentMediaKey(item), altText: item.alt ?? "",
    })),
    sentCaption: { ...momentSubmissionMetadata(draft, draft.media.length > 0), text: draft.caption },
    sentTitle: draft.memoryTitle.trim() || "Tonight's Memory",
    serverMemoryId: "memory-1",
  };
}

beforeEach(() => {
  expect(typeof indexedDB).toBe("undefined");
  localStorage.clear();
  // Every write in these tests lands in the same millisecond.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T21:00:00.000Z"));
});

afterEach(async () => {
  if (mountedRoot) await act(async () => mountedRoot?.unmount());
  mountedRoot = null;
  mountedContainer?.remove();
  mountedContainer = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Moment save receipts on the fallback lane", () => {
  it("keeps a confirmed Memory id for the same account to resume", async () => {
    const draft = captionDraft();
    await saveMomentDraft(draft);
    await settleMomentDraftProgress(OWNER, draft.id, { uploadedMedia: [], sentCaption: null, sentTitle: null, serverMemoryId: "memory-1" });
    expect(await loadMomentDraft(OWNER)).toMatchObject({ id: draft.id, serverMemoryId: "memory-1", caption: "A night worth keeping" });
  });

  it("clears the draft once the server holds everything in it", async () => {
    const draft = captionDraft();
    await saveMomentDraft(draft);
    await settleMomentDraftProgress(OWNER, draft.id, confirmedReceipt(draft));
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("never recreates a draft a sign-out purged", async () => {
    const draft = captionDraft();
    await saveMomentDraft(draft);
    await deleteMomentDraft(OWNER);
    await settleMomentDraftProgress(OWNER, draft.id, { uploadedMedia: [], sentCaption: null, sentTitle: null, serverMemoryId: "memory-1" });
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("keeps a newer edit of the same draft written in the same millisecond", async () => {
    const draft = { ...captionDraft(), media: [photo("one")] };
    await saveMomentDraft(draft);
    await saveMomentDraft({ ...draft, caption: "A newer visit's caption", revision: 2 });
    await settleMomentDraftProgress(OWNER, draft.id, confirmedReceipt(draft));
    expect(await loadMomentDraft(OWNER)).toMatchObject({ caption: "A newer visit's caption", serverMemoryId: "memory-1" });
  });

  it("touches only its own owner's draft", async () => {
    const guest = captionDraft("guest");
    const mine = captionDraft();
    await saveMomentDraft(guest);
    await saveMomentDraft(mine);
    await settleMomentDraftProgress(OWNER, mine.id, confirmedReceipt(mine));
    await settleMomentDraftProgress("guest", mine.id, confirmedReceipt(mine));
    expect(await loadMomentDraft("guest")).toMatchObject({ id: guest.id, caption: guest.caption });
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("keeps a photo whose bytes a newer edit replaced after the original was confirmed", async () => {
    const original = { ...captionDraft(), media: [photo("one"), photo("two")] };
    // Fallback rows keep no photo bytes, so the confirmed photo is checked
    // through the receipt rule the store applies to every row.
    const cropped = { ...original, media: [{ ...photo("one"), version: "cropped-1" }, photo("two")] };
    const remaining = applyMomentSaveReceipt(cropped, confirmedReceipt({ ...original, media: [original.media[0]!] }));
    expect(remaining?.media.map((item) => `${item.id}@${item.version ?? ""}`)).toEqual(["one@cropped-1", "two@"]);
  });
});


describe("late Moment confirmations preserve newer submitted metadata", () => {
  it("keeps a newer photo description with the same photo bytes", () => {
    const submitted = { ...captionDraft(), media: [{ ...photo("one"), alt: "The old description" }] };
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, media: [{ ...submitted.media[0]!, alt: "The new description" }], revision: 2 };
    const remaining = applyMomentSaveReceipt(newer, receipt);
    expect(remaining?.media).toHaveLength(1);
    expect(remaining?.media[0]?.alt).toBe("The new description");
    expect(remaining?.serverMemoryId).toBe("memory-1");
  });

  it.each([
    ["venue", { venueId: "pub-two" }],
    ["time", { occurredAt: "2026-10-05T22:00:00.000Z" }],
  ] as const)("keeps newer photo %s metadata with the same photo bytes", (_, patch) => {
    const submitted = { ...captionDraft(), venueId: "pub-one", media: [photo("one")] };
    const receipt = confirmedReceipt(submitted);
    const remaining = applyMomentSaveReceipt({ ...submitted, ...patch, revision: 2 }, receipt);
    expect(remaining?.media.map((item) => item.id)).toEqual(["one"]);
    expect(remaining).toMatchObject({ ...patch, serverMemoryId: "memory-1" });
  });

  it.each([
    ["venue", { venueId: "pub-two" }],
    ["time", { occurredAt: "2026-10-05T22:00:00.000Z" }],
    ["text kind", { kind: "quote" }],
  ] as const)("keeps newer text-only %s metadata loadable with the same caption", async (_, patch) => {
    const submitted = { ...captionDraft(), venueId: "pub-one", kind: "side_quest" as const };
    const receipt = confirmedReceipt(submitted);
    await saveMomentDraft(submitted);
    await saveMomentDraft({ ...submitted, ...patch, revision: 2 });
    await settleMomentDraftProgress(OWNER, submitted.id, receipt);
    expect(await loadMomentDraft(OWNER)).toMatchObject({
      ...patch, caption: submitted.caption, serverMemoryId: "memory-1",
    });
  });

  it("preserves a newer local night title without retaining confirmed caption content", async () => {
    const submitted = { ...captionDraft(), memoryTitle: "The first title" };
    const receipt = confirmedReceipt(submitted);
    await saveMomentDraft(submitted);
    await saveMomentDraft({ ...submitted, memoryTitle: "The newer title", revision: 2 });
    await settleMomentDraftProgress(OWNER, submitted.id, receipt);
    expect(await loadMomentDraft(OWNER)).toMatchObject({
      memoryTitle: "The newer title", caption: "", serverMemoryId: "memory-1",
    });
  });
});

describe("Moment receipt normalization and independent content", () => {
  it("captures the effective photo and text wire metadata", () => {
    const draft = captionDraft();
    expect(momentSubmissionMetadata(draft, false)).toEqual({
      kind: "side_quest", venueId: null, occurredAt: "2026-10-05T21:00:00.000Z",
    });
    expect(momentSubmissionMetadata({ ...draft, kind: "quote", venueId: "pub-one" }, true)).toEqual({
      kind: "photo", venueId: "pub-one", occurredAt: "2026-10-05T21:00:00.000Z",
    });
  });

  it.each([undefined, ""])("consumes a confirmed photo with an omitted or empty description: %s", (alt) => {
    const submitted = { ...captionDraft(), media: [photo("one")] };
    const receipt = confirmedReceipt(submitted);
    const media = [{ ...submitted.media[0]!, alt }] as MomentMediaDraft[];
    expect(applyMomentSaveReceipt({ ...submitted, media }, receipt)).toBeNull();
  });

  it.each([undefined, null, ""])("consumes text with equivalent absent venue references: %s", async (venueId) => {
    const submitted = captionDraft();
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, venueId, kind: "side_quest" } as MomentDraftV1;
    await saveMomentDraft(newer);
    await settleMomentDraftProgress(OWNER, submitted.id, receipt);
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });

  it("consumes a confirmed photo while keeping independent new photo content and caption edits", () => {
    const submitted = { ...captionDraft(), media: [photo("one")] };
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, caption: "An independent new caption", media: [...submitted.media, photo("two")], revision: 2 };
    const remaining = applyMomentSaveReceipt(newer, receipt);
    expect(remaining?.media.map((item) => item.id)).toEqual(["two"]);
    expect(remaining?.caption).toBe("An independent new caption");
    expect(remaining?.serverMemoryId).toBe("memory-1");
  });

  it("consumes a matching later photo confirmation without retaining the same bytes twice", () => {
    const submitted = { ...captionDraft(), media: [photo("one")] };
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, media: [{ ...photo("one"), alt: "The later description" }] };
    receipt.uploadedMedia.push(...confirmedReceipt(newer).uploadedMedia);
    expect(applyMomentSaveReceipt(newer, receipt)).toBeNull();
  });

  it("consumes unchanged content with the wire default title and text kind", async () => {
    const submitted = captionDraft();
    const receipt = confirmedReceipt(submitted);
    const newer = { ...submitted, memoryTitle: "Tonight's Memory", kind: "side_quest" as const };
    await saveMomentDraft(newer);
    await settleMomentDraftProgress(OWNER, submitted.id, receipt);
    expect(await loadMomentDraft(OWNER)).toBeNull();
  });
});


let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

async function mountComposer(caption = "Submitted caption") {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mounted.owner = OWNER;
  mounted.calls.length = 0;
  mounted.pending.length = 0;
  mounted.replace.mockClear();
  setProviderIdentity("supabase", OWNER);
  setProviderAuthState("supabase", "authenticated");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  let counter = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:mounted-${counter++}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  await saveMomentDraft({ ...captionDraft(), caption });
  mountedContainer = document.createElement("div");
  document.body.append(mountedContainer);
  mountedRoot = createRoot(mountedContainer);
  await act(async () => { mountedRoot?.render(createElement(MomentCapture)); });
  await vi.waitFor(() => expect(captionInput().value).toBe(caption));
}

function captionInput(): HTMLTextAreaElement {
  const input = mountedContainer?.querySelector<HTMLTextAreaElement>(".momentFields textarea");
  if (!input) throw new Error("Caption input missing");
  return input;
}

async function editCaption(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(captionInput(), text);
    captionInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function addPhoto(name: string) {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const input = mountedContainer?.querySelector<HTMLInputElement>("#moment-photo-file");
  if (!input) throw new Error("Photo input missing");
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new File([bytes], name, { type: "image/jpeg" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(() => expect(mountedContainer?.querySelector(`button[aria-label="Remove ${name}"]`)).not.toBeNull());
}

async function holdPhotoIntake(name: string) {
  const bytes = new Uint8Array(64);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const file = new File([bytes], name, { type: "image/jpeg" });
  let release = () => {};
  let started = false;
  const admitted = new Promise<ArrayBuffer>((resolve) => { release = () => resolve(bytes.buffer); });
  const slice = file.slice.bind(file);
  Object.defineProperty(file, "slice", { value: (...args: Parameters<File["slice"]>) => {
    const chunk = slice(...args);
    Object.defineProperty(chunk, "arrayBuffer", { value: () => { started = true; return admitted; } });
    return chunk;
  } });
  const input = mountedContainer?.querySelector<HTMLInputElement>("#moment-photo-file");
  if (!input) throw new Error("Photo input missing");
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(started).toBe(true);
  return async () => { await act(async () => { release(); }); };
}

async function startMountedSave() {
  const form = mountedContainer?.querySelector<HTMLFormElement>("form.momentComposer");
  if (!form) throw new Error("Moment form missing");
  await act(async () => { form.requestSubmit(); });
  await vi.waitFor(() => expect(mounted.pending.length).toBeGreaterThan(0));
}

async function completePost(index: number, status = 201) {
  await act(async () => {
    mounted.pending[index]!(new Response(JSON.stringify(status === 201 ? { moment: { id: `moment-${index}` } } : { error: "Upload unavailable" }), { status }));
  });
}

describe("mounted Moment save completion", () => {
  it("merges intake completed after Save with the new draft without restoring consumed photos", async () => {
    await mountComposer();
    await addPhoto("already-saved.jpg");
    const consumedUrl = mountedContainer?.querySelector("figure.momentMedia img")?.getAttribute("src");
    await startMountedSave();
    const release = await holdPhotoIntake("later-intake.jpg");
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await completePost(0);
    expect(mountedContainer?.querySelector('button[aria-label="Remove already-saved.jpg"]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(consumedUrl);
    await release();
    expect(mountedContainer?.querySelector('button[aria-label="Remove later-intake.jpg"]')).not.toBeNull();
    expect(mountedContainer?.querySelector('button[aria-label="Remove already-saved.jpg"]')).toBeNull();
    const newUrl = mountedContainer?.querySelector("figure.momentMedia img")?.getAttribute("src");
    expect(newUrl).toBeTruthy();
    expect(newUrl).not.toBe(consumedUrl);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(newUrl);
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(mounted.replace).not.toHaveBeenCalled();
    const form = mountedContainer?.querySelector<HTMLFormElement>("form.momentComposer");
    await act(async () => { form?.requestSubmit(); });
    expect(mounted.pending).toHaveLength(2);
    const posts = mounted.calls.filter((call) => call.url.endsWith("/moments"));
    expect((posts[1]!.init.body as FormData).get("photo")).toMatchObject({ name: "later-intake.jpg" });
    await completePost(1);
    expect(mounted.calls.filter((call) => call.url.endsWith("/moments"))).toHaveLength(2);
  });

  it("merges held intake with a photo added and a photo removed while admission waits", async () => {
    await mountComposer();
    await addPhoto("removed.jpg");
    const release = await holdPhotoIntake("held.jpg");
    await act(async () => { mountedContainer?.querySelector<HTMLButtonElement>('button[aria-label="Remove removed.jpg"]')?.click(); });
    await addPhoto("added-during-wait.jpg");
    await release();
    expect(mountedContainer?.querySelector('button[aria-label="Remove removed.jpg"]')).toBeNull();
    expect(mountedContainer?.querySelector('button[aria-label="Remove held.jpg"]')).not.toBeNull();
    expect(mountedContainer?.querySelector('button[aria-label="Remove added-during-wait.jpg"]')).not.toBeNull();
    expect(mountedContainer?.querySelectorAll("figure.momentMedia")).toHaveLength(2);
  });

  it("adds ordinary photos without a save or held admission", async () => {
    await mountComposer();
    await addPhoto("ordinary-one.jpg");
    await addPhoto("ordinary-two.jpg");
    expect(mountedContainer?.querySelectorAll("figure.momentMedia")).toHaveLength(2);
    expect(captionInput().value).toBe("Submitted caption");
    expect(mountedContainer?.textContent).toContain("2 photos added.");
    expect(mounted.calls).toHaveLength(0);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("refuses held intake when the account changes before admission completes", async () => {
    await mountComposer();
    const release = await holdPhotoIntake("a-held.jpg");
    const other = "account-b";
    await saveMomentDraft({ ...captionDraft(other), caption: "B's intake boundary" });
    await act(async () => {
      mounted.owner = other;
      setProviderIdentity("supabase", other);
      mountedRoot?.render(createElement(MomentCapture));
    });
    await vi.waitFor(() => expect(captionInput().value).toBe("B's intake boundary"));
    await release();
    expect(captionInput().value).toBe("B's intake boundary");
    expect(mountedContainer?.querySelectorAll("figure.momentMedia")).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(await loadMomentDraft(other)).toMatchObject({ caption: "B's intake boundary" });
  });

  it.each([201, 503])("keeps a caption edited during a held POST that answers %s", async (status) => {
    await mountComposer();
    await startMountedSave();
    await editCaption("Newer unsent caption");
    expect(captionInput().value).toBe("Newer unsent caption");
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await completePost(0, status);
    expect(captionInput().value).toBe("Newer unsent caption");
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(await loadMomentDraft(OWNER)).toMatchObject({ caption: "Newer unsent caption", serverMemoryId: "memory-mounted" });
    expect(mounted.replace).not.toHaveBeenCalled();
  });

  it("keeps an edit queued in the same React batch as the held response completion", async () => {
    await mountComposer();
    await startMountedSave();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(captionInput(), "Same-batch newer caption");
      captionInput().dispatchEvent(new Event("input", { bubbles: true }));
      mounted.pending[0]!(new Response(JSON.stringify({ moment: { id: "same-batch" } }), { status: 201 }));
    });
    expect(captionInput().value).toBe("Same-batch newer caption");
    await vi.waitFor(async () => expect(await loadMomentDraft(OWNER)).toMatchObject({ caption: "Same-batch newer caption" }));
  });

  it("keeps a new photo and its preview when the earlier photo POST succeeds", async () => {
    await mountComposer();
    await addPhoto("submitted-one.jpg");
    await startMountedSave();
    await addPhoto("new-two.jpg");
    const retainedUrl = mountedContainer?.querySelectorAll<HTMLImageElement>("figure.momentMedia img")[1]?.getAttribute("src");
    expect(retainedUrl).toBeTruthy();
    await completePost(0);
    expect(mountedContainer?.querySelector('button[aria-label="Remove new-two.jpg"]')).not.toBeNull();
    expect(mountedContainer?.querySelector('button[aria-label="Remove submitted-one.jpg"]')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(retainedUrl);
    expect(mountedContainer?.querySelector("figure.momentMedia img")?.getAttribute("src")).toBe(retainedUrl);
    expect(mounted.replace).not.toHaveBeenCalled();
  });

  it("keeps newer caption and added photo after a partial save failure", async () => {
    await mountComposer();
    await addPhoto("submitted-one.jpg");
    await addPhoto("pending-two.jpg");
    await startMountedSave();
    await completePost(0);
    await vi.waitFor(() => expect(mounted.pending).toHaveLength(2));
    await editCaption("New partial-save caption");
    await addPhoto("new-three.jpg");
    await completePost(1, 503);
    expect(captionInput().value).toBe("New partial-save caption");
    expect(mountedContainer?.querySelector('button[aria-label="Remove pending-two.jpg"]')).not.toBeNull();
    expect(mountedContainer?.querySelector('button[aria-label="Remove new-three.jpg"]')).not.toBeNull();
    expect(mountedContainer?.querySelector('button[aria-label="Remove submitted-one.jpg"]')).toBeNull();
    await vi.waitFor(async () => expect(await loadMomentDraft(OWNER)).toMatchObject({ caption: "New partial-save caption", serverMemoryId: "memory-mounted" }));
  });

  it("completes and returns normally when no new edits remain", async () => {
    await mountComposer();
    await startMountedSave();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await completePost(0);
    expect(captionInput().value).toBe("");
    expect(mountedContainer?.textContent).toContain("Moment saved privately.");
    expect(await loadMomentDraft(OWNER)).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(mounted.replace).toHaveBeenCalledTimes(1);
  });

  it("does not navigate away from edits made during the saved receipt delay", async () => {
    await mountComposer();
    await startMountedSave();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await completePost(0);
    await editCaption("A new draft after the confirmation");
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(captionInput().value).toBe("A new draft after the confirmation");
    expect(await loadMomentDraft(OWNER)).toMatchObject({ caption: "A new draft after the confirmation" });
    expect(mounted.replace).not.toHaveBeenCalled();
  });

  it("keeps replacement-account content after an old mounted save completes", async () => {
    await mountComposer();
    await startMountedSave();
    const other = "account-b";
    await saveMomentDraft({ ...captionDraft(other), caption: "B's private caption" });
    await act(async () => {
      mounted.owner = other;
      setProviderIdentity("supabase", other);
      mountedRoot?.render(createElement(MomentCapture));
    });
    await vi.waitFor(() => expect(captionInput().value).toBe("B's private caption"));
    await completePost(0);
    expect(captionInput().value).toBe("B's private caption");
    expect(await loadMomentDraft(other)).toMatchObject({ caption: "B's private caption" });
    expect(mounted.replace).not.toHaveBeenCalled();
  });
});
