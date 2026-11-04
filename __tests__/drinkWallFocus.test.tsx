// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
const shell = vi.hoisted(() => ({ native: false, pick: vi.fn() }));

vi.mock("@/lib/authedFetch", () => ({ authedFetch: network.read, authedActionFetch: network.write }));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => shell.native }));
vi.mock("@/lib/nativeCamera", () => ({ pickNativePhoto: shell.pick }));
vi.mock("@/components/auth/AuthProvider", async () => {
  const context = await vi.importActual<typeof import("@/components/auth/authContext")>("@/components/auth/authContext");
  return { useAuth: context.useAuth };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const attributes = { ...props };
    delete attributes.unoptimized;
    return createElement("img", attributes);
  },
}));

import DrinkWallComposer from "@/components/drink-wall/DrinkWallComposer";
import DrinkWall from "@/components/drink-wall/DrinkWall";
import { AuthContext, useAuth, type AuthContextValue } from "@/components/auth/authContext";
import type { DrinkWallPhotoDTO } from "@/lib/drinkWall";

let host: HTMLDivElement;
let root: Root;
let currentUserId: string | null;

function WallWithViewer({ id = "viewer-a", revision = 1 }: { id?: string; revision?: number }) {
  const defaults = useAuth();
  return createElement(AuthContext.Provider, {
    value: {
      ...defaults,
      user: { id } as NonNullable<AuthContextValue["user"]>,
      handle: id,
      configured: true,
      accountRevision: revision,
      providerAuthState: "authenticated",
      getCurrentUserId: () => currentUserId,
    },
  }, createElement(DrinkWall));
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

async function activate(control: HTMLButtonElement): Promise<void> {
  control.focus();
  await act(async () => control.click());
}

async function pickPub(): Promise<void> {
  await activate(button("Link a pub"));
  const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(document.activeElement).toBe(search);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "French House");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTimeAsync(220));
  const result = [...host.querySelectorAll("button")].find((node) => node.textContent === "The French HouseSoho")!;
  expect(result).toBeDefined();
  await activate(result);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  network.read.mockReset();
  network.write.mockReset();
  shell.native = false;
  shell.pick.mockReset();
  currentUserId = "viewer-a";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    venues: [{ id: "french-house", name: "The French House", area: "Soho" }],
  })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(DrinkWallComposer, { onCancel: () => {}, onPosted: () => {} }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the photo composer's pub link", () => {
  it("keeps focus on the selected pub control after choosing a real search result", async () => {
    await pickPub();

    expect(host.textContent).toContain("The French House");
    expect(document.activeElement).toBe(button("Remove"));
    expect(network.write).not.toHaveBeenCalled();
  });

  it("returns focus to Link a pub after removing the selection", async () => {
    await pickPub();
    await activate(button("Remove"));

    expect(host.textContent).not.toContain("The French House");
    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect(document.activeElement).toBe(button("Link a pub"));
    expect(network.write).not.toHaveBeenCalled();
  });

  it.each(["button", "Escape"])("returns focus after cancelling the pub search with %s", async (method) => {
    await activate(button("Link a pub"));
    if (method === "button") {
      await activate(button("Cancel"));
    } else {
      await act(async () => {
        host.querySelector('input[type="search"]')!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
    }

    expect(host.querySelector('input[type="search"]')).toBeNull();
    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect(document.activeElement).toBe(button("Link a pub"));
    expect(network.write).not.toHaveBeenCalled();
  });

  it("does not move focus from the caption during ordinary edits", async () => {
    await pickPub();
    const caption = host.querySelector("textarea")!;
    caption.focus();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(caption, "An evening in Soho");
      caption.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(document.activeElement).toBe(caption);
    expect(host.textContent).toContain("The French House");
    expect(network.write).not.toHaveBeenCalled();
  });
});

describe("cancelling an unsent wall photo", () => {
  it("returns focus to the wall while a changed filter is still loading", async () => {
    let finishRead!: (response: Response) => void;
    network.read
      .mockResolvedValueOnce(Response.json({ status: "ready", photos: [], nextCursor: null }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRead = resolve; }));
    await act(async () => root.render(createElement(WallWithViewer)));
    await activate(button("Add a photo"));
    const filter = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Photo type"] button')]
      .find((control) => control.textContent === "Pint")!;
    await activate(filter);
    expect(host.textContent).toContain("Loading the wall");
    expect([...host.querySelectorAll("button")].some((control) => control.textContent === "Add a photo")).toBe(false);
    await activate(button("Cancel"));

    expect(host.querySelector("textarea")).toBeNull();
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement).toBe(host.querySelector("h1"));
    expect(network.write).not.toHaveBeenCalled();
    await act(async () => finishRead(Response.json({ status: "ready", photos: [], nextCursor: null })));
  });

  it.each([false, true])("returns focus to its Add a photo opener with existing photos=%s", async (hasPhotos) => {
    const existing: DrinkWallPhotoDTO = {
      id: "existing-photo", venueId: null, venueName: null, wallCategory: "london", placeLabel: null,
      url: "/api/drink-wall-photo/existing-photo", drinkCategory: null, caption: "A London view",
      width: 1080, height: 1350, createdAt: "2026-11-04T00:00:00Z",
      author: { handle: "another-drinker" }, ownedByViewer: false,
    };
    network.read.mockResolvedValue(Response.json({ status: "ready", photos: hasPhotos ? [existing] : [], nextCursor: null }));
    await act(async () => root.render(createElement(WallWithViewer)));
    const opener = button("Add a photo");
    await activate(opener);
    await pickPub();
    await activate(button("Cancel"));

    expect(host.querySelector("textarea")).toBeNull();
    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect(document.activeElement).toBe(opener);
    expect(network.write).not.toHaveBeenCalled();
  });
});

describe("an account change with an unsent photo draft", () => {
  it("does not carry the previous viewer's caption and linked pub into another account", async () => {
    network.read.mockResolvedValue(Response.json({ status: "ready", photos: [], nextCursor: null }));
    await act(async () => root.render(createElement(WallWithViewer)));
    await activate(button("Add a photo"));
    await pickPub();
    const caption = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(caption, "Private draft from viewer A");
      caption.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(caption.value).toBe("Private draft from viewer A");

    currentUserId = "viewer-b";
    await act(async () => root.render(createElement(WallWithViewer, { id: "viewer-b", revision: 2 })));

    expect(host.querySelector("textarea")?.value).not.toBe("Private draft from viewer A");
    expect(host.textContent).not.toContain("The French House");
    expect(network.write).not.toHaveBeenCalled();
  });
});

describe("the real cropper's account-owned upload", () => {
  let finishCrop: BlobCallback;

  beforeEach(() => {
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:wall-photo");
      static revokeObjectURL = vi.fn();
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      finishCrop = callback;
    });
    network.read.mockImplementation(async () => Response.json({ status: "ready", photos: [], nextCursor: null }));
    network.write.mockImplementation(async () => Response.json({ error: "Fixture upload refused" }, { status: 400 }));
  });

  async function confirmRealCrop(): Promise<void> {
    await act(async () => root.render(createElement(WallWithViewer)));
    await activate(button("Add a photo"));
    await pickPub();
    const caption = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(caption, "Private draft from viewer A");
      caption.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["fixture image"], "wall.jpg", { type: "image/jpeg" });
    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const image = host.querySelector<HTMLImageElement>(".profileCropImage")!;
    expect(image).not.toBeNull();
    await act(async () => {
      Object.defineProperties(image, { naturalWidth: { value: 1080 }, naturalHeight: { value: 1350 } });
      image.dispatchEvent(new Event("load"));
    });
    const confirm = host.querySelector<HTMLButtonElement>(".profileCropConfirm")!;
    expect(confirm.disabled).toBe(false);
    await activate(confirm);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1);
    expect(network.write).not.toHaveBeenCalled();
  }

  async function releaseCrop(): Promise<void> {
    await act(async () => finishCrop(new Blob(["cropped fixture"], { type: "image/jpeg" })));
  }

  it.each(["account switch", "cancel", "live owner change"])("rejects a delayed crop after %s", async (transition) => {
    await confirmRealCrop();
    if (transition === "account switch") {
      currentUserId = "viewer-b";
      await act(async () => root.render(createElement(WallWithViewer, { id: "viewer-b", revision: 2 })));
      expect(host.querySelector("textarea")?.value).toBe("");
      expect(host.textContent).not.toContain("The French House");
    } else if (transition === "cancel") {
      await activate([...host.querySelectorAll<HTMLButtonElement>(".venuePhotoComposerActions button")][0]);
      await activate(button("Add a photo"));
    } else {
      currentUserId = "viewer-b";
    }

    await releaseCrop();

    expect(network.write).not.toHaveBeenCalled();
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(host.textContent).not.toContain("Fixture upload refused");
  });

  it("uploads the same owner's real crop with its caption and pub, and reports errors", async () => {
    await confirmRealCrop();
    await releaseCrop();

    expect(network.write).toHaveBeenCalledTimes(1);
    const [url, options, auth] = network.write.mock.calls[0];
    expect(url).toBe("/api/drink-wall");
    expect(options.method).toBe("POST");
    expect(auth).toEqual({ requiresIdentity: true });
    expect(JSON.parse(options.body.get("post"))).toEqual({
      wallCategory: "london", venueId: "french-house", placeLabel: "", drinkCategory: null,
      caption: "Private draft from viewer A",
    });
    expect(options.body.get("photo")).toBeInstanceOf(File);
    expect(host.textContent).toContain("Fixture upload refused");
    expect(host.querySelector<HTMLButtonElement>(".profileCropConfirm")?.disabled).toBe(false);
  });

  it("closes the same owner's composer and refreshes the wall after a successful upload", async () => {
    network.write.mockImplementation(async () => Response.json({ photo: { id: "fixture-photo" } }));
    await confirmRealCrop();
    const reads = network.read.mock.calls.length;
    await releaseCrop();

    expect(network.write).toHaveBeenCalledTimes(1);
    expect(host.querySelector("textarea")).toBeNull();
    expect(network.read).toHaveBeenCalledTimes(reads + 1);
    expect(button("Add a photo")).toBeDefined();
  });

  it.each(["missing photo", "network failure"])("keeps the same owner's draft after %s", async (outcome) => {
    network.write.mockImplementation(async () => {
      if (outcome === "network failure") throw new Error("Fixture network failure");
      return Response.json({});
    });
    await confirmRealCrop();
    await releaseCrop();

    expect(network.write).toHaveBeenCalledTimes(1);
    expect(host.querySelector("textarea")?.value).toBe("Private draft from viewer A");
    expect(host.textContent).toContain("Could not add that photo. Try again.");
    expect(host.querySelector<HTMLButtonElement>(".profileCropConfirm")?.disabled).toBe(false);
  });

  it.each(["chosen", "blocked", "cancelled"])("ignores a pending native photo result after an account switch: %s", async (outcome) => {
    shell.native = true;
    let finishPick!: (result: unknown) => void;
    shell.pick.mockImplementation(() => new Promise((resolve) => { finishPick = resolve; }));
    await act(async () => root.render(createElement(WallWithViewer)));
    await activate(button("Add a photo"));
    await activate(button("Choose a photo"));
    expect(shell.pick).toHaveBeenCalledWith("venue");
    currentUserId = "viewer-b";
    await act(async () => root.render(createElement(WallWithViewer, { id: "viewer-b", revision: 2 })));
    await act(async () => finishPick({
      outcome, file: new File(["fixture"], "native.jpg", { type: "image/jpeg" }), message: "Fixture camera blocked",
    }));

    expect(host.querySelector(".profileCropImage")).toBeNull();
    expect(host.textContent).not.toContain("Fixture camera blocked");
    expect(host.querySelector("textarea")?.value).toBe("");
    expect(network.write).not.toHaveBeenCalled();
  });

  it.each(["success", "error", "network failure"])("ignores an old owner's upload completion: %s", async (outcome) => {
    let complete!: (response: Response) => void;
    let fail!: (error: Error) => void;
    network.write.mockImplementation(() => new Promise<Response>((resolve, reject) => { complete = resolve; fail = reject; }));
    await confirmRealCrop();
    await releaseCrop();
    expect(network.write).toHaveBeenCalledTimes(1);
    currentUserId = "viewer-b";
    await act(async () => root.render(createElement(WallWithViewer, { id: "viewer-b", revision: 2 })));
    const nextCaption = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(nextCaption, "Viewer B's draft");
      nextCaption.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const reads = network.read.mock.calls.length;
    await act(async () => {
      if (outcome === "network failure") fail(new Error("Fixture network failure"));
      else complete(Response.json(outcome === "success" ? { photo: { id: "fixture-photo" } } : { error: "Fixture upload refused" }, {
        status: outcome === "success" ? 200 : 400,
      }));
    });

    expect(host.querySelector("textarea")?.value).toBe("Viewer B's draft");
    expect(host.textContent).not.toContain("Fixture upload refused");
    expect(network.read).toHaveBeenCalledTimes(reads);
  });
});
