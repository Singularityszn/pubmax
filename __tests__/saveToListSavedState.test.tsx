// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SaveToListControl from "@/components/savedpubs/SaveToListControl";

// A list chip is a switch: the first press saves, the second removes. It used
// to look the same both ways and the removal said nothing, so a person who
// pressed "Want to Visit" twice lost the save without being told.

const authedFetch = vi.hoisted(() => vi.fn());
const authedActionFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedFetch, authedActionFetch }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  authedFetch.mockReset();
  authedActionFetch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function open(): Promise<void> {
  await act(async () => {
    root.render(createElement(SaveToListControl, { venueId: "venue-1", venueName: "The Lamb" }));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>("button.saveToListToggle")!.click();
  });
}

function chip(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>("button.saveToListChip")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!match) throw new Error(`no chip "${name}"`);
  return match;
}

describe("SaveToListControl chips", () => {
  it("shows the saved state, announces it, and says so when a second press removes the save", async () => {
    await open();
    expect(chip("Want to Visit").getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      chip("Want to Visit").click();
    });
    expect(chip("Want to Visit").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".saveToListToast")?.textContent).toBe("Saved to “Want to Visit”");
    // A neighbouring chip is untouched.
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      chip("Want to Visit").click();
    });
    expect(chip("Want to Visit").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".saveToListToast")?.textContent).toBe(
      "Removed from “Want to Visit”",
    );
  });

  it("opens with the lists this pub is already in pressed", async () => {
    window.localStorage.setItem(
      "pubmax:savedPubs:v1",
      JSON.stringify([
        { venueId: "venue-1", listType: "Date Night", savedAt: "2026-10-06T10:00:00.000Z" },
        { venueId: "venue-2", listType: "Want to Visit", savedAt: "2026-10-06T10:00:00.000Z" },
      ]),
    );
    await open();

    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Want to Visit").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("SaveToListControl chips for a signed-in handle", () => {
  const row = (listType: string) => ({
    venueId: "venue-1",
    venueName: "The Lamb",
    venueMapUrl: "/map?sel=venue-1",
    listType,
    savedAt: "2026-10-06T10:00:00.000Z",
  });
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("takes the state from the server's answer, and from what it already holds on open", async () => {
    window.localStorage.setItem("pubmax_handle", "mia");
    let held: string[] = ["Date Night"];
    authedFetch.mockImplementation(async (input: string, init?: { method?: string }) => {
      if (input.includes("lists=1")) return json({ lists: [] });
      if (init?.method === "POST") {
        held = held.includes("Want to Visit")
          ? held.filter((name) => name !== "Want to Visit")
          : [...held, "Want to Visit"];
        return json({ saved: held.map(row) });
      }
      return json({ saved: held.map(row) });
    });

    await open();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    // The pub is already on a list the server holds, so that chip opens pressed.
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Want to Visit").getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      chip("Want to Visit").click();
    });
    expect(chip("Want to Visit").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      chip("Want to Visit").click();
    });
    expect(chip("Want to Visit").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".saveToListToast")?.textContent).toBe(
      "Removed from “Want to Visit”",
    );
  });
});
