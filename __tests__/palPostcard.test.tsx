// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PalPostcard from "@/components/pal/PalPostcard";
import {
  PAL_POSTCARD_MAX_STOPS,
  palPostcardDate,
  palPostcardPath,
  palPostcardPoints,
  palPostcardStops,
} from "@/components/pal/palPostcardLayout";
import { DEFAULT_PAL_DRAFT, type PubPal } from "@/lib/pubPal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pal(overrides: Partial<PubPal> = {}): PubPal {
  const now = "2026-10-04T12:00:00.000Z";
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner", name: "Ripley", adultAttestedAt: now,
    appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
    muted: false, hidden: false, proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    ...overrides,
  } as PubPal;
}

function store(value: PubPal) {
  window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(value));
}

const NIGHT = { stops: ["The Crown", "The Lamb", "The Harp"], title: "Soho on a Saturday", completedAt: "2026-10-18T23:40:00.000Z" };

let root: Root | null = null;
let host: HTMLElement;

async function render(props: { stops: string[]; title: string; completedAt: string | null } = NIGHT) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(PalPostcard, props));
  });
  // The stored Pal is read after mount.
  await act(async () => {
    await Promise.resolve();
  });
}

function saveButton(): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(".palPostcardSave")!;
}

function status(): string {
  return host.querySelector("[role='status']")?.textContent ?? "";
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the postcard's layout", () => {
  it("climbs from the bottom left to the top right, inside the box", () => {
    const points = palPostcardPoints(4, 600, 260, 40);
    expect(points).toHaveLength(4);
    expect(points[0]!.x).toBe(40);
    expect(points[3]!.x).toBe(560);
    expect(points[3]!.y).toBeLessThan(points[0]!.y);
    for (const point of points) {
      expect(point.y).toBeGreaterThanOrEqual(40);
      expect(point.y).toBeLessThanOrEqual(220);
    }
  });

  it("holds no more stops than the card can show, and none for no stops", () => {
    expect(palPostcardPoints(20, 600, 260, 40)).toHaveLength(PAL_POSTCARD_MAX_STOPS);
    expect(palPostcardPoints(0, 600, 260, 40)).toEqual([]);
    expect(palPostcardPath([])).toBe("");
  });

  it("draws one curve between each pair of stops", () => {
    const path = palPostcardPath(palPostcardPoints(3, 600, 260, 40));
    expect(path.startsWith("M 40.0")).toBe(true);
    expect(path.match(/ C /g)).toHaveLength(2);
  });

  it("keeps the first stops and the true last stop of a long night", () => {
    const names = Array.from({ length: 11 }, (_, index) => `Pub ${index + 1}`);
    const kept = palPostcardStops(names);
    expect(kept).toHaveLength(PAL_POSTCARD_MAX_STOPS);
    expect(kept[0]).toBe("Pub 1");
    expect(kept[kept.length - 1]).toBe("Pub 11");
    expect(palPostcardStops([" The Crown ", "", "The Lamb"])).toEqual(["The Crown", "The Lamb"]);
  });

  it("dates the night in London time, by the evening it started on", () => {
    // 00:40 on Monday in London is still Sunday's night out.
    expect(palPostcardDate("2026-10-18T23:40:00.000Z")).toBe("Sunday 18 October 2026");
    expect(palPostcardDate("2026-10-17T21:15:00.000Z")).toBe("Saturday 17 October 2026");
    expect(palPostcardDate(null)).toBeNull();
    expect(palPostcardDate("not a date")).toBeNull();
  });
});

describe("the postcard on the recap", () => {
  it("shows the person's Pal at the last stop, with the route and its line", async () => {
    store(pal());
    await render();
    const card = host.querySelector("[data-testid='pal-postcard']")!;
    expect(host.querySelector("#pal-postcard-title")?.textContent).toBe("A postcard from Ripley");
    expect(card.querySelectorAll(".palPostcardDot")).toHaveLength(3);
    expect(card.querySelector(".palPostcardRoute")?.getAttribute("aria-label")).toBe(
      "The route: The Crown, then The Lamb, then The Harp.",
    );
    expect(card.querySelector(".palPostcardLine")?.textContent).toBe("Ripley walked all 3 stops with you.");
    expect(card.querySelector(".palPostcardTitle")?.textContent).toBe("Soho on a Saturday");
    expect(card.querySelector(".palPostcardPal img")).not.toBeNull();
    expect(status()).toBe("Only you see this until you share it.");
  });

  it("carries no drink count, price or total", async () => {
    store(pal());
    await render();
    const text = host.textContent ?? "";
    expect(text).not.toMatch(/£|pint|drink/i);
  });

  it("is never made for no Pal, a hidden Pal, or a night of one stop", async () => {
    await render();
    expect(host.querySelector("[data-testid='pal-postcard']")).toBeNull();
    act(() => root?.unmount());
    host.remove();

    store(pal({ hidden: true }));
    await render();
    expect(host.querySelector("[data-testid='pal-postcard']")).toBeNull();
    act(() => root?.unmount());
    host.remove();

    store(pal());
    await render({ ...NIGHT, stops: ["The Crown"] });
    expect(host.querySelector("[data-testid='pal-postcard']")).toBeNull();
  });

  it("says so, and keeps the card, when the browser cannot draw it", async () => {
    store(pal());
    await render();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await act(async () => saveButton().click());
    expect(status()).toBe("That did not work. Try again.");
    expect(host.querySelector("[data-testid='pal-postcard']")).not.toBeNull();
  });

  describe("saving the image", () => {
    function fakeCanvas() {
      const context = new Proxy({} as Record<string, unknown>, {
        get: (target, key) => (key in target ? target[key as string] : () => ({ width: 10 })),
        set: (target, key, value) => {
          target[key as string] = value;
          return true;
        },
      });
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) {
        callback(new Blob(["png"], { type: "image/png" }));
      });
      vi.stubGlobal("Path2D", class {});
      // The Pal photograph loads at once.
      vi.stubGlobal(
        "Image",
        class {
          onload: (() => void) | null = null;
          onerror: (() => void) | null = null;
          set src(_value: string) {
            queueMicrotask(() => this.onload?.());
          }
        },
      );
    }

    it("hands the image to the share sheet where the device can share files", async () => {
      store(pal());
      await render();
      fakeCanvas();
      const share = vi.fn(async () => {});
      Object.assign(navigator, { canShare: () => true, share });
      await act(async () => saveButton().click());
      expect(share).toHaveBeenCalledOnce();
      const [{ files, title }] = share.mock.calls[0] as unknown as [{ files: File[]; title: string }];
      expect(files[0]!.name).toBe("pal-postcard.png");
      expect(files[0]!.type).toBe("image/png");
      expect(title).toBe("A postcard from Ripley");
      expect(status()).toBe("Postcard ready.");
      Object.assign(navigator, { canShare: undefined, share: undefined });
    });

    it("treats a closed share sheet as a choice, not a failure", async () => {
      store(pal());
      await render();
      fakeCanvas();
      Object.assign(navigator, {
        canShare: () => true,
        share: async () => {
          throw new DOMException("closed", "AbortError");
        },
      });
      await act(async () => saveButton().click());
      expect(status()).toBe("Only you see this until you share it.");
      Object.assign(navigator, { canShare: undefined, share: undefined });
    });

    it("downloads the image where the device cannot share files", async () => {
      store(pal());
      await render();
      fakeCanvas();
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:postcard", revokeObjectURL: () => {} }));
      const clicked: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
      await act(async () => saveButton().click());
      expect(clicked).toEqual(["pal-postcard.png"]);
      expect(status()).toBe("Postcard ready.");
    });
  });
});
