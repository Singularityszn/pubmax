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

describe("SaveToListControl new list", () => {
  it("leaves the save in place when the typed name already holds this pub", async () => {
    window.localStorage.setItem(
      "pubmax:savedPubs:v1",
      JSON.stringify([
        { venueId: "venue-1", listType: "Date Night", savedAt: "2026-10-06T10:00:00.000Z" },
      ]),
    );
    await open();
    const input = container.querySelector<HTMLInputElement>("input[aria-label='New list name']")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Date Night");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.saveToListCreate")!.click();
    });

    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".saveToListToast")?.textContent).toBe("Saved to “Date Night”");
    expect(JSON.parse(window.localStorage.getItem("pubmax:savedPubs:v1") ?? "[]")).toHaveLength(1);
  });

  it("matches the name as it is stored, so stray spaces neither mislabel nor remove the save", async () => {
    await open();
    const input = container.querySelector<HTMLInputElement>("input[aria-label='New list name']")!;
    const create = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>("button.saveToListCreate")!.click();
      });
    };

    await create("Quiz  nights ");
    expect(container.querySelector(".saveToListToast")?.textContent).toBe("Saved to “Quiz nights”");

    await create(" Quiz nights");
    expect(container.querySelector(".saveToListToast")?.textContent).toBe("Saved to “Quiz nights”");
    const stored = JSON.parse(window.localStorage.getItem("pubmax:savedPubs:v1") ?? "[]") as {
      listType: string;
    }[];
    expect(stored.map((row) => row.listType)).toEqual(["Quiz nights"]);
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

describe("SaveToListControl as the inspector moves between pubs", () => {
  async function rerenderWith(venueId: string): Promise<void> {
    await act(async () => {
      root.render(createElement(SaveToListControl, { venueId, venueName: "Next pub" }));
    });
  }

  it("starts the next pub from its own membership, not the last pub's", async () => {
    await open();
    await act(async () => {
      chip("Date Night").click();
    });
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");

    await rerenderWith("venue-2");

    // venue-2 is in no list, so nothing is pressed, and "Create & save" with the
    // name venue-1 holds would write for venue-2 rather than skip it.
    expect(
      [...container.querySelectorAll("button.saveToListChip")].every(
        (c) => c.getAttribute("aria-pressed") === "false",
      ),
    ).toBe(true);
  });

  it("drops a membership answer that was asked before a press", async () => {
    window.localStorage.setItem("pubmax_handle", "mia");
    const row = (listType: string) => ({
      venueId: "venue-1",
      venueName: "The Lamb",
      venueMapUrl: "/map?sel=venue-1",
      listType,
      savedAt: "2026-10-06T10:00:00.000Z",
    });
    let release: (value: Response) => void = () => undefined;
    let reads = 0;
    authedFetch.mockImplementation(async (input: string, init?: { method?: string }) => {
      if (input.includes("lists=1")) return new Response(JSON.stringify({ lists: [] }), { status: 200 });
      if (init?.method === "POST") return new Response(JSON.stringify({ saved: [row("Date Night")] }), { status: 200 });
      reads += 1;
      if (reads === 1) return new Response(JSON.stringify({ saved: [] }), { status: 200 });
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });

    await open();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    // Close and open again: the server's membership is known, and a second read
    // is now in flight while the person presses.
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.saveToListClose")!.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.saveToListToggle")!.click();
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(reads).toBe(2);

    await act(async () => {
      chip("Date Night").click();
    });
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");

    // The second read finally answers with the OLD membership (nothing saved).
    await act(async () => {
      release(new Response(JSON.stringify({ saved: [] }), { status: 200 }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the chips shut until the server's membership lands, so a save made elsewhere is not judged from this device", async () => {
    window.localStorage.setItem("pubmax_handle", "mia");
    let release: (value: Response) => void = () => undefined;
    authedFetch.mockImplementation(async (input: string) => {
      if (input.includes("lists=1")) return new Response(JSON.stringify({ lists: [] }), { status: 200 });
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    await open();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(chip("Date Night").disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("button.saveToListCreate")!.disabled).toBe(true);

    await act(async () => {
      release(
        new Response(
          JSON.stringify({
            saved: [
              {
                venueId: "venue-1",
                venueName: "The Lamb",
                venueMapUrl: "/map?sel=venue-1",
                listType: "Date Night",
                savedAt: "2026-10-06T10:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        ),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(chip("Date Night").disabled).toBe(false);
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");
  });

  it("says so, and keeps the chips shut, when the server's membership cannot be read", async () => {
    window.localStorage.setItem("pubmax_handle", "mia");
    authedFetch.mockImplementation(async (input: string) => {
      if (input.includes("lists=1")) return new Response(JSON.stringify({ lists: [] }), { status: 200 });
      return new Response("no", { status: 500 });
    });
    await open();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(chip("Date Night").disabled).toBe(true);
    expect(container.querySelector(".saveToListToast")?.textContent).toBe(
      "Could not load your lists. Close and open again.",
    );
  });

  it("still asks the server for membership when the list registry answers an error", async () => {
    window.localStorage.setItem("pubmax_handle", "mia");
    authedFetch.mockImplementation(async (input: string) => {
      if (input.includes("lists=1")) return new Response("no", { status: 500 });
      return new Response(
        JSON.stringify({
          saved: [
            {
              venueId: "venue-1",
              venueName: "The Lamb",
              venueMapUrl: "/map?sel=venue-1",
              listType: "Date Night",
              savedAt: "2026-10-06T10:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      );
    });

    await open();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");
  });

  it("brings this device's store into line with the server after a toggle that disagreed", async () => {
    // The server already holds Date Night for this pub and this device does not.
    // The device store toggles first (adds it), the server toggle removes it, and
    // the device must end up without it, or a signed-out read shows a removed save.
    window.localStorage.setItem("pubmax_handle", "mia");
    authedFetch.mockImplementation(async (input: string, init?: { method?: string }) => {
      if (input.includes("lists=1")) return new Response(JSON.stringify({ lists: [] }), { status: 200 });
      if (init?.method === "POST") return new Response(JSON.stringify({ saved: [] }), { status: 200 });
      return new Response(
        JSON.stringify({
          saved: [
            {
              venueId: "venue-1",
              venueName: "The Lamb",
              venueMapUrl: "/map?sel=venue-1",
              listType: "Date Night",
              savedAt: "2026-10-06T10:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      );
    });
    await open();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      chip("Date Night").click();
    });

    expect(container.querySelector(".saveToListToast")?.textContent).toBe(
      "Removed from “Date Night”",
    );
    const stored = JSON.parse(window.localStorage.getItem("pubmax:savedPubs:v1") ?? "[]") as {
      venueId: string;
      listType: string;
    }[];
    expect(stored.some((row) => row.venueId === "venue-1" && row.listType === "Date Night")).toBe(false);
  });

  it("does not call a failed save a removal, and keeps this device's save, when the server answers the list unchanged", async () => {
    // The saves route answers a failed write with 200 and the list as it was.
    window.localStorage.setItem("pubmax_handle", "mia");
    authedFetch.mockImplementation(async (input: string) => {
      if (input.includes("lists=1")) return new Response(JSON.stringify({ lists: [] }), { status: 200 });
      return new Response(JSON.stringify({ saved: [] }), { status: 200 });
    });
    await open();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      chip("Date Night").click();
    });

    expect(container.querySelector(".saveToListToast")?.textContent).toBe(
      "Could not update “Date Night”. Try again.",
    );
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("false");
    const stored = JSON.parse(window.localStorage.getItem("pubmax:savedPubs:v1") ?? "[]") as {
      venueId: string;
      listType: string;
    }[];
    expect(stored.some((row) => row.venueId === "venue-1" && row.listType === "Date Night")).toBe(true);
  });

  it("does not call a failed removal a save when the server answers the list unchanged", async () => {
    window.localStorage.setItem("pubmax_handle", "mia");
    const held = {
      venueId: "venue-1",
      venueName: "The Lamb",
      venueMapUrl: "/map?sel=venue-1",
      listType: "Date Night",
      savedAt: "2026-10-06T10:00:00.000Z",
    };
    authedFetch.mockImplementation(async (input: string) => {
      if (input.includes("lists=1")) return new Response(JSON.stringify({ lists: [] }), { status: 200 });
      return new Response(JSON.stringify({ saved: [held] }), { status: 200 });
    });
    await open();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      chip("Date Night").click();
    });

    expect(container.querySelector(".saveToListToast")?.textContent).toBe(
      "Could not update “Date Night”. Try again.",
    );
    expect(chip("Date Night").getAttribute("aria-pressed")).toBe("true");
  });

  it("ignores the answer of a save that was started for the previous pub", async () => {
    window.localStorage.setItem("pubmax_handle", "mia");
    let finish: (value: Response) => void = () => undefined;
    authedFetch.mockImplementation(async (input: string, init?: { method?: string }) => {
      if (init?.method === "POST") return new Promise<Response>((resolve) => { finish = resolve; });
      return new Response(JSON.stringify(input.includes("lists=1") ? { lists: [] } : { saved: [] }), { status: 200 });
    });
    await open();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      chip("Date Night").click();
    });
    await rerenderWith("venue-2");
    await act(async () => {
      finish(
        new Response(
          JSON.stringify({
            saved: [
              {
                venueId: "venue-1",
                venueName: "The Lamb",
                venueMapUrl: "/map?sel=venue-1",
                listType: "Date Night",
                savedAt: "2026-10-06T10:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        ),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(
      [...container.querySelectorAll("button.saveToListChip")].every(
        (c) => c.getAttribute("aria-pressed") === "false",
      ),
    ).toBe(true);
    expect(container.querySelector(".saveToListToast")).toBeNull();
  });
});

