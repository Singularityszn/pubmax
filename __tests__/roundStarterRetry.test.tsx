// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    session: null,
    loading: false,
    handle: null,
    getCurrentUserId: () => null,
  }),
}));

import RoundStarter from "@/components/round/RoundStarter";

const fetchMock = vi.fn<typeof fetch>();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(RoundStarter, { defaultTitle: "Big night" })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function typeHandle(value: string) {
  const input = container.querySelector<HTMLInputElement>("input")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function tapStart() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

const sentKeys = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).clientRequestId);

const started = () => Response.json(
  {
    round: { id: "r1", code: "ABCD23", title: "Big night", createdByHandle: "ken", createdAt: "", closedAt: null },
    members: [],
    stops: [],
    spends: [],
  },
  { status: 201 },
);

describe("RoundStarter retry", () => {
  it("resends the first key when a start is tapped again after a lost answer", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(started());
    typeHandle("ken");
    await tapStart();
    await vi.waitFor(() => expect(container.textContent).toContain("Could not start the Round"));
    await tapStart();
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/rounds/ABCD23"));

    const [first, second] = sentKeys();
    expect(first).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
    expect(second).toBe(first);
  });

  it("starts a new attempt when the handle changes", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(started());
    typeHandle("ken");
    await tapStart();
    await vi.waitFor(() => expect(container.textContent).toContain("Could not start the Round"));
    typeHandle("kenny");
    await tapStart();
    await vi.waitFor(() => expect(push).toHaveBeenCalled());

    const [first, second] = sentKeys();
    expect(second).not.toBe(first);
  });
});
