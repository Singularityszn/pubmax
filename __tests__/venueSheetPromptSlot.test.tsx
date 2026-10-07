// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authedActionFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch,
  authedFetch: vi.fn(),
}));

import SaveToListControl from "@/components/savedpubs/SaveToListControl";
import SaveForNightButton from "@/components/wanted/SaveForNightButton";

// One prompt at a time on the venue sheet: the list picker, the save-for-a-night
// reply and the check-in reply took turns at nothing and stacked. Each control
// now yields its prompt when a sibling owns the slot, and a save with no handle
// says it lives on this device rather than reading like a synced save.

let container: HTMLDivElement;
let root: Root;

async function flush(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  authedActionFetch.mockReset().mockResolvedValue(
    Response.json({ status: "sign_in_required" }, { status: 401 }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function renderNight(active: boolean, onActivate?: () => void): Promise<void> {
  return act(async () => {
    root.render(
      createElement(SaveForNightButton, {
        venueId: "venue-1",
        venueName: "The Lamb",
        active,
        onActivate,
      }),
    );
  });
}

describe("SaveForNightButton prompt slot", () => {
  it("claims the slot on tap and says it needs a sign-in", async () => {
    const onActivate = vi.fn();
    await renderNight(true, onActivate);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".wantedSaveBtn")!.click();
    });
    await flush();
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Sign in to save for a night.");
  });

  it("hides its reply while another prompt owns the slot", async () => {
    await renderNight(true);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".wantedSaveBtn")!.click();
    });
    await flush();
    expect(container.textContent).toContain("Sign in to save for a night.");

    await renderNight(false);
    expect(container.textContent).not.toContain("Sign in to save for a night.");
  });
});

describe("SaveToListControl prompt slot", () => {
  it("is open only while the host says so, and reports taps", async () => {
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        createElement(SaveToListControl, {
          venueId: "venue-1",
          venueName: "The Lamb",
          open: false,
          onOpenChange,
        }),
      );
    });
    expect(container.querySelector(".saveToList")).toBeNull();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".saveToListToggle")!.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // A controlled control waits for the host rather than opening itself.
    expect(container.querySelector(".saveToList")).toBeNull();

    await act(async () => {
      root.render(
        createElement(SaveToListControl, {
          venueId: "venue-1",
          venueName: "The Lamb",
          open: true,
          onOpenChange,
        }),
      );
    });
    expect(container.querySelector(".saveToList")).not.toBeNull();
  });

  it("says a save with no handle lives on this device", async () => {
    await act(async () => {
      root.render(createElement(SaveToListControl, { venueId: "venue-1", venueName: "The Lamb" }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".saveToListToggle")!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".saveToListChip")!.click();
    });
    await flush();
    expect(container.querySelector(".saveToListToast")?.textContent).toMatch(
      /^Saved to “.+” on this device$/,
    );
  });
});
