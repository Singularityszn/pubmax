// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
  submit: vi.fn(),
  native: false,
  pickNativePhoto: vi.fn(),
}));

vi.mock("@/components/auth/authContext", () => ({
  useAuth: () => ({
    user: null, session: null, loading: false, configured: false,
    handle: null, identityResolved: true, getCurrentUserId: () => null,
  }),
}));
vi.mock("@/components/identity/ContributionGateDialog", () => ({
  useContributionGate: () => ({
    requestContribution: async (action: (auth: { accessToken: string }) => unknown) =>
      action({ accessToken: "test-token" }),
    contributionGateDialog: null,
  }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/map/PriceContributionImpact", () => ({ default: () => null }));
vi.mock("@/lib/nativePlatform", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/nativePlatform")>(),
  isNativeApp: () => io.native,
}));
vi.mock("@/lib/nativeCamera", () => ({ pickNativePhoto: io.pickNativePhoto }));

import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import { usePintDrops, type PintDropsState, type PhotoSlotName } from "@/components/map/usePintDrops";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { UPLOAD_PHOTO_MAX_BYTES } from "@/lib/uploadBodyLimit";

let container: HTMLDivElement;
let root: Root;
let drops: PintDropsState;

function photo(size: number): File {
  return new File([new Uint8Array(size)], "bill.jpg", { type: "image/jpeg" });
}

function DropProbe() {
  const state = usePintDrops();
  useEffect(() => { drops = state; }, [state]);
  return null;
}

async function choose(slot: "receipt" | "pint", file: File): Promise<void> {
  if (io.native) {
    io.pickNativePhoto.mockResolvedValue({ outcome: "chosen", file });
    const button = container.querySelector<HTMLButtonElement>(`[data-testid=${slot}-photo-btn]`);
    if (!button) throw new Error("Photo button did not render");
    await act(async () => { button.click(); });
  } else {
    const label = slot === "receipt" ? "Photo of the bill at The Test Arms" : "Optional pint photo for The Test Arms";
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!input) throw new Error("Photo input did not render");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  }
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  io.native = false;
  io.submit.mockReset();
  io.pickNativePhoto.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ drops: [] }) }));
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: vi.fn().mockReturnValue("blob:photo"),
    revokeObjectURL: vi.fn(),
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the full Pint Drop composer photo boundary", () => {
  it.each<PhotoSlotName>(["pint", "venue", "receipt"])("refuses oversized %s photos without replacing the accepted slot", async (slot) => {
    await act(async () => { root.render(createElement(DropProbe)); });
    const accepted = photo(UPLOAD_PHOTO_MAX_BYTES);
    await act(async () => { drops.pickPhoto(slot, accepted, null); });
    expect(drops[`${slot}Photo`]?.file).toBe(accepted);
    expect(drops.dropMsg).toBeNull();

    const input = document.createElement("input");
    input.value = "selected-file";
    await act(async () => { drops.pickPhoto(slot, photo(UPLOAD_PHOTO_MAX_BYTES + 1), input); });
    expect(drops.dropMsg).toEqual({ ok: false, text: "Each photo must be under 4\u00a0MB." });
    expect(drops[`${slot}Photo`]?.file).toBe(accepted);
    expect(input.value).toBe("");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    await act(async () => { drops.removePhoto(slot); });
    expect(drops[`${slot}Photo`]).toBeNull();
    await act(async () => { drops.pickPhoto(slot, accepted, null); });
    expect(drops.dropMsg).toBeNull();
    expect(drops[`${slot}Photo`]?.file).toBe(accepted);
  });
});

describe.each([false, true])("the quick price composer with native=%s", (native) => {
  beforeEach(async () => {
    io.native = native;
    const communityPrices = {
      byVenueId: new Map(), signalsByVenueId: new Map(), freshestByVenueId: new Map(),
      venuePriceStatus: new Map(), submit: io.submit, submitting: false,
    } as unknown as CommunityPricesState;
    await act(async () => {
      root.render(createElement(VenuePriceSubmit, {
        venueId: "venue-test", venueName: "The Test Arms", communityPrices,
      }));
    });
    const price = container.querySelector<HTMLButtonElement>(".vpsubQuickChip");
    if (!price) throw new Error("Price chip did not render");
    await act(async () => { price.click(); });
  });

  it.each(["receipt", "pint"] as const)("refuses an oversized %s and recovers when a supported photo is chosen", async (slot) => {
    const accepted = photo(UPLOAD_PHOTO_MAX_BYTES);
    if (slot === "pint") await choose("receipt", accepted);
    await choose(slot, accepted);
    expect(container.querySelector(`[data-testid=${slot}-photo-btn]`)?.textContent).toBe(
      slot === "receipt" ? "Change the bill" : "Change the pint",
    );
    await choose(slot, photo(UPLOAD_PHOTO_MAX_BYTES + 1));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Each photo must be under 4\u00a0MB.");
    expect(container.querySelector(`[data-testid=${slot}-photo-btn]`)?.textContent).toBe(
      slot === "receipt" ? "Photo of the bill" : "Photo of your pint",
    );
    expect(container.querySelector<HTMLButtonElement>(".vpsubLog")?.disabled).toBe(slot === "receipt");
    expect(io.submit).not.toHaveBeenCalled();

    await choose(slot, accepted);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".vpsubLog")?.disabled).toBe(false);
    io.submit.mockResolvedValue({ ok: true, attribution: { status: "credited", handle: "alice" }, price: null });
    const submit = container.querySelector<HTMLButtonElement>(".vpsubLog")!;
    await act(async () => { submit.click(); });
    expect(io.submit).toHaveBeenCalledWith(expect.objectContaining({
      venueId: "venue-test", receiptPhoto: accepted,
      ...(slot === "pint" ? { pintPhoto: accepted } : {}),
    }), { accessToken: "test-token" });
  });
});
