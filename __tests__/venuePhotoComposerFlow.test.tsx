// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The pub photo composer is three beats and one action. "Use photo" accepts the
// crop and publishes nothing: the drink, the caption and the crosspost box sit
// under the preview, and "Post photo" is the only control that sends the
// photo. This fence drives that order, and the owner's Remove on the wall.

const authedActionFetch = vi.fn();
const authedFetch = vi.fn();

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (...args: unknown[]) => authedActionFetch(...args),
  authedFetch: (...args: unknown[]) => authedFetch(...args),
}));

vi.mock("@/components/profile/ProfileImageCropper", () => ({
  default: ({ onCropped, onCancel }: { onCropped: (file: File) => void; onCancel: () => void }) =>
    createElement(
      "div",
      { "data-testid": "cropper" },
      createElement(
        "button",
        {
          type: "button",
          onClick: () => onCropped(new File(["jpeg"], "crop.jpg", { type: "image/jpeg" })),
        },
        "Use photo",
      ),
      createElement("button", { type: "button", onClick: onCancel }, "Cancel crop"),
    ),
}));

const viewer = vi.hoisted(() => ({ auth: { user: { id: "user-1" }, handle: "mia", configured: true } }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => viewer.auth,
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/map" }));

import VenuePhotoComposer from "@/components/venue/VenuePhotoComposer";
import VenuePhotoWall from "@/components/venue/VenuePhotoWall";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  authedActionFetch.mockReset();
  authedFetch.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`no button labelled "${label}"`);
  return match as HTMLButtonElement;
}

function hasButton(label: string): boolean {
  return [...container.querySelectorAll("button")].some(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

async function pickFile(): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
  const file = new File(["raw"], "pint.jpg", { type: "image/jpeg" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("VenuePhotoComposer", () => {
  it("accepts the crop without publishing, then posts once from the button under the fields", async () => {
    authedActionFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          photo: {
            id: "photo-1",
            venueId: "venue-1",
            wallCategory: "pub",
            placeLabel: "The Lamb",
            url: "/api/venue-photos/photo-1",
            drinkCategory: "beer",
            caption: "Cold one",
            width: 1080,
            height: 1350,
            createdAt: "2026-10-06T10:00:00.000Z",
            author: { handle: "mia", avatarUrl: null },
            ownedByViewer: true,
          },
          crosspost: { state: "off" },
        }),
        { status: 201 },
      ),
    );
    const onPosted = vi.fn();
    await act(async () => {
      root.render(
        createElement(VenuePhotoComposer, {
          venueId: "venue-1",
          venueName: "The Lamb",
          onCancel: vi.fn(),
          onPosted,
        }),
      );
    });

    await pickFile();
    await act(async () => {
      button("Use photo").click();
    });

    // Accepting the crop sent nothing, and the fields are now on screen.
    expect(authedActionFetch).not.toHaveBeenCalled();
    expect(container.querySelector("img[alt^='Your photo of The Lamb']")).not.toBeNull();
    expect(container.querySelector("#venue-photo-caption")).not.toBeNull();
    expect(hasButton("Post photo")).toBe(true);

    const caption = container.querySelector<HTMLTextAreaElement>("#venue-photo-caption")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setValue.call(caption, "Cold one");
      caption.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Beer").click();
    });
    await act(async () => {
      button("Post photo").click();
    });

    expect(authedActionFetch).toHaveBeenCalledTimes(1);
    const [, init] = authedActionFetch.mock.calls[0]! as [string, { body: FormData }];
    const sent = JSON.parse(String(init.body.get("post")));
    expect(sent).toMatchObject({
      venueId: "venue-1",
      drinkCategory: "beer",
      caption: "Cold one",
    });
    expect(init.body.get("photo")).toBeInstanceOf(File);
    expect(onPosted).toHaveBeenCalledTimes(1);
  });

  it("shows no publish control, and no fields, before a photo is cropped", async () => {
    await act(async () => {
      root.render(
        createElement(VenuePhotoComposer, {
          venueId: "venue-1",
          venueName: "The Lamb",
          onCancel: vi.fn(),
          onPosted: vi.fn(),
        }),
      );
    });

    expect(hasButton("Post photo")).toBe(false);
    expect(container.querySelector("#venue-photo-caption")).toBeNull();
    expect(hasButton("Choose a photo")).toBe(true);
  });

  it("returns to the choose step when the crop is cancelled", async () => {
    await act(async () => {
      root.render(
        createElement(VenuePhotoComposer, {
          venueId: "venue-1",
          venueName: "The Lamb",
          onCancel: vi.fn(),
          onPosted: vi.fn(),
        }),
      );
    });

    await pickFile();
    await act(async () => {
      button("Cancel crop").click();
    });

    expect(hasButton("Choose a photo")).toBe(true);
    expect(hasButton("Post photo")).toBe(false);
  });
});

describe("VenuePhotoWall owner control", () => {
  const photo = (id: string, ownedByViewer: boolean) => ({
    id,
    venueId: "venue-1",
    wallCategory: "pub",
    placeLabel: "The Lamb",
    url: `/api/venue-photos/${id}`,
    drinkCategory: null,
    caption: "",
    width: 1080,
    height: 1350,
    createdAt: "2026-10-06T10:00:00.000Z",
    author: { handle: ownedByViewer ? "mia" : "zed", avatarUrl: null },
    ownedByViewer,
  });

  it("offers Remove on the viewer's own photo only, and takes it off the wall", async () => {
    authedFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          photos: [photo("mine", true), photo("theirs", false)],
          nextCursor: null,
          status: "ready",
        }),
        { status: 200 },
      ),
    );
    authedActionFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      root.render(createElement(VenuePhotoWall, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelectorAll(".venuePhotoRemove")).toHaveLength(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".venuePhotoRemove")!.click();
    });

    const [url, init] = authedActionFetch.mock.calls[0]! as [string, { body: string }];
    expect(url).toBe("/api/venue-photos");
    expect(JSON.parse(init.body)).toEqual({ action: "delete", id: "mine" });
    expect(container.querySelectorAll(".venuePhotoTile")).toHaveLength(1);
    expect(container.querySelector(".venuePhotoRemove")).toBeNull();
  });

  it("keeps the photo when the person declines the confirm", async () => {
    authedFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ photos: [photo("mine", true)], nextCursor: null, status: "ready" }),
        { status: 200 },
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await act(async () => {
      root.render(createElement(VenuePhotoWall, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".venuePhotoRemove")!.click();
    });

    expect(authedActionFetch).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".venuePhotoTile")).toHaveLength(1);
  });

  it("reads the wall again for the next account after an in-place switch", async () => {
    viewer.auth = { user: { id: "user-1" }, handle: "mia", configured: true };
    authedFetch.mockImplementation(async () =>
      new Response(
        JSON.stringify({ photos: [photo("mine", true)], nextCursor: null, status: "ready" }),
        { status: 200 },
      ),
    );
    await act(async () => {
      root.render(createElement(VenuePhotoWall, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelectorAll(".venuePhotoRemove")).toHaveLength(1);
    const readsBefore = authedFetch.mock.calls.length;

    // Another account, same mounted wall: the photo is no longer theirs.
    viewer.auth = { user: { id: "user-2" }, handle: "zed", configured: true };
    authedFetch.mockImplementation(async () =>
      new Response(
        JSON.stringify({ photos: [photo("mine", false)], nextCursor: null, status: "ready" }),
        { status: 200 },
      ),
    );
    await act(async () => {
      root.render(createElement(VenuePhotoWall, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(authedFetch.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(container.querySelectorAll(".venuePhotoRemove")).toHaveLength(0);
    viewer.auth = { user: { id: "user-1" }, handle: "mia", configured: true };
  });

  it("keeps every Remove disabled while one removal is in flight", async () => {
    authedFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          photos: [photo("a", true), photo("b", true)],
          nextCursor: null,
          status: "ready",
        }),
        { status: 200 },
      ),
    );
    let finish: (value: Response) => void = () => undefined;
    authedActionFetch.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      root.render(createElement(VenuePhotoWall, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const [first, second] = [...container.querySelectorAll<HTMLButtonElement>(".venuePhotoRemove")];
    await act(async () => {
      first!.click();
    });
    expect(second!.disabled).toBe(true);
    await act(async () => {
      second!.click();
    });
    expect(authedActionFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await Promise.resolve();
    });
  });

  it("drops a read that was asked for the previous viewer", async () => {
    viewer.auth = { user: { id: "user-1" }, handle: "mia", configured: true };
    let answerFirst: (value: Response) => void = () => undefined;
    let calls = 0;
    authedFetch.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return new Promise<Response>((resolve) => { answerFirst = resolve; });
      return Promise.resolve(
        new Response(JSON.stringify({ photos: [photo("p", false)], nextCursor: null, status: "ready" }), { status: 200 }),
      );
    });
    await act(async () => {
      root.render(createElement(VenuePhotoWall, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    viewer.auth = { user: { id: "user-2" }, handle: "zed", configured: true };
    await act(async () => {
      root.render(createElement(VenuePhotoWall, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // user-1's slow read now answers, claiming the photo is theirs.
    await act(async () => {
      answerFirst(
        new Response(JSON.stringify({ photos: [photo("p", true)], nextCursor: null, status: "ready" }), { status: 200 }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelectorAll(".venuePhotoRemove")).toHaveLength(0);
    viewer.auth = { user: { id: "user-1" }, handle: "mia", configured: true };
  });

  it("gives every Remove its own accessible name", async () => {
    viewer.auth = { user: { id: "user-1" }, handle: "mia", configured: true };
    authedFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          photos: [{ ...photo("a", true), caption: "Cold one" }, photo("b", true)],
          nextCursor: null,
          status: "ready",
        }),
        { status: 200 },
      ),
    );
    await act(async () => {
      root.render(createElement(VenuePhotoWall, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const names = [...container.querySelectorAll(".venuePhotoRemove")].map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain("Cold one");
  });
});

