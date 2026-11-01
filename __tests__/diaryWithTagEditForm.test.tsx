// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The diary edit form's "Who you were with": each tag already asked has its own
// untag control, and a new @handle goes in one field. Save sends the ids taken
// off and the raw field, and nothing when neither changed.

const authedActionFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedFetch: vi.fn(), authedActionFetch }));
vi.mock("@/lib/venueMapUrl", () => ({ venueMapUrl: (id: string) => `/map/${id}` }));

import { DiaryEntryRow } from "@/components/diary/DiaryList";
import type { DiaryEntryDTO } from "@/lib/diary";

const SAM_TAG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRIYA_TAG = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const ENTRY = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ownerUserId: "acct",
  venueId: "venue-1",
  venueName: "The Dove",
  visitedOn: "2026-10-29",
  rating: null,
  review: "",
  usualDrink: "",
  withNames: "",
  visibility: "private",
  createdAt: "2026-10-29T20:00:00.000Z",
  withTags: { approved: ["sam"], pending: 1 },
  withTagList: [
    { id: SAM_TAG, handle: "sam", state: "approved" },
    { id: PRIYA_TAG, handle: "priya", state: "proposed" },
  ],
} as DiaryEntryDTO;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  authedActionFetch.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function button(label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    ?? [...container.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Who you were with, on the diary edit form", () => {
  it("untags one person, asks one more, and hands the fresh tags back", async () => {
    const onChanged = vi.fn();
    authedActionFetch.mockResolvedValue(
      new Response(JSON.stringify({ entry: { ...ENTRY, withTagList: [] }, tagsSent: true }), { status: 200 }),
    );
    await act(async () => {
      root.render(createElement(DiaryEntryRow, { entry: ENTRY, onChanged, onRemoved: () => {} }));
    });
    await act(async () => button("Edit your diary entry for The Dove").click());

    const fieldset = container.querySelector("[data-testid=diary-edit-with]")!;
    expect(fieldset.textContent).toContain("@sam");
    expect(fieldset.textContent).toContain("@priya, waiting for a yes");

    await act(async () => button("Untag @sam").click());
    expect(button("Keep @sam tagged").getAttribute("aria-pressed")).toBe("true");
    await act(async () => type(container.querySelector<HTMLInputElement>("[data-testid=diary-edit-with-add]")!, "@jo"));
    await act(async () => button("Save changes").click());

    const sent = JSON.parse(String(authedActionFetch.mock.calls[0]![1].body));
    expect(sent).toMatchObject({ action: "update", withAdd: "@jo", withRemove: [SAM_TAG] });
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ id: ENTRY.id }), true);
  });

  it("sends no tag fields when the tags were left alone, and keeps the row's tags", async () => {
    const onChanged = vi.fn();
    authedActionFetch.mockResolvedValue(new Response(JSON.stringify({ entry: ENTRY }), { status: 200 }));
    await act(async () => {
      root.render(createElement(DiaryEntryRow, { entry: ENTRY, onChanged, onRemoved: () => {} }));
    });
    await act(async () => button("Edit your diary entry for The Dove").click());
    await act(async () => button("Save changes").click());

    const sent = JSON.parse(String(authedActionFetch.mock.calls[0]![1].body));
    expect(sent).not.toHaveProperty("withAdd");
    expect(sent).not.toHaveProperty("withRemove");
    expect(onChanged).toHaveBeenCalledWith(expect.anything(), false);
  });
});
