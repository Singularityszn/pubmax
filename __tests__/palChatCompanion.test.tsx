// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";

const fetches = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: fetches.fetch }));
vi.mock("@/lib/localPal", () => ({ readLocalPal: () => null, subscribeLocalPal: () => () => {} }));
vi.mock("@/components/pal/PalPortrait", () => ({ default: ({ name }: { name: string }) => createElement("span", null, name) }));
import PalChatCompanion from "@/components/pal/PalChatCompanion";

let root: Root;
let container: HTMLDivElement;
function response(ownerId: string, name: string) {
  return new Response(JSON.stringify({ pal: { ownerId, name, id: ownerId, appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality } }));
}
async function render(owner: string | null) {
  await act(async () => { root.render(createElement(PalChatCompanion, { owner, state: "idle" })); });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetches.fetch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("hides the prior owner's Pal immediately during account changes and sign-out", async () => {
  fetches.fetch.mockResolvedValueOnce(response("owner-a", "Alice Pal")).mockImplementation(() => new Promise(() => {}));
  await render("owner-a");
  expect(container.textContent).toBe("Alice Pal");
  await render("owner-b");
  expect(container.textContent).toBe("Pub Pal");
  await render("anonymous");
  expect(container.textContent).toBe("Pub Pal");
  await render(null);
  expect(container.textContent).toBe("Pub Pal");
});

it("aborts an old owner's read and ignores its late completion", async () => {
  let finishA!: (value: Response) => void;
  fetches.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finishA = resolve; }))
    .mockResolvedValueOnce(response("owner-b", "Bob Pal"));
  await render("owner-a");
  const signal = fetches.fetch.mock.calls[0]?.[1]?.signal as AbortSignal | undefined;
  await render("owner-b");
  expect(signal?.aborted).toBe(true);
  expect(container.textContent).toBe("Bob Pal");
  await act(async () => { finishA(response("owner-a", "Alice Pal")); });
  expect(container.textContent).toBe("Bob Pal");
});
