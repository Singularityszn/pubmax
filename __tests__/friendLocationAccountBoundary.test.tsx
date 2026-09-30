// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFriendLocations } from "@/components/map/friends/useFriendLocations";

const auth = vi.hoisted(() => ({
  user: { id: "10000000-0000-4000-8000-000000000001" },
  session: { access_token: "disposable-unit-token" },
  accountRevision: 0,
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));

let root: Root;
let host: HTMLDivElement;
let latest: ReturnType<typeof useFriendLocations>;
function Probe() {
  const result = useFriendLocations();
  useLayoutEffect(() => { latest = result; });
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  auth.accountRevision = 0;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("clears private memory and cancels the old controller on provider account revision", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(Response.json({
      ok: true, generation: 0, own: null, mutuals: [], friends: [{
        profileId: "mate", handle: "bob", latitude: 51.5, longitude: -0.1,
        accuracy: 110, updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }],
    }))
    .mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", request);
  await act(async () => { root.render(createElement(Probe)); });
  expect(latest.state.friends).toHaveLength(1);
  const previous = latest.client;
  auth.accountRevision++;
  await act(async () => { root.render(createElement(Probe)); });
  expect(latest.client).not.toBe(previous);
  expect(previous.getSnapshot().friends).toEqual([]);
  expect(latest.state.friends).toEqual([]);
  expect(request).toHaveBeenCalledTimes(2);
});
