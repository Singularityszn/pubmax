// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));

vi.mock("@/lib/authedFetch", () => ({ authedFetch: network.read, authedActionFetch: network.write }));
vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => false }));
vi.mock("@/lib/nativeCamera", () => ({ pickNativePhoto: vi.fn() }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({ default: () => null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "viewer" }, handle: "viewer", configured: true }),
}));
vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({ user: { id: "viewer" } }),
}));
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
import type { DrinkWallPhotoDTO } from "@/lib/drinkWall";

let host: HTMLDivElement;
let root: Root;

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
  it.each([false, true])("returns focus to its Add a photo opener with existing photos=%s", async (hasPhotos) => {
    const existing: DrinkWallPhotoDTO = {
      id: "existing-photo", venueId: null, venueName: null, wallCategory: "london", placeLabel: null,
      url: "/api/drink-wall-photo/existing-photo", drinkCategory: null, caption: "A London view",
      width: 1080, height: 1350, createdAt: "2026-11-04T00:00:00Z",
      author: { handle: "another-drinker" }, ownedByViewer: false,
    };
    network.read.mockResolvedValue(Response.json({ status: "ready", photos: hasPhotos ? [existing] : [], nextCursor: null }));
    await act(async () => root.render(createElement(DrinkWall)));
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
