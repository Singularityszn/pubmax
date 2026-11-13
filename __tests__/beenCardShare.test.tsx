// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ mint: vi.fn() }));
vi.mock("@/lib/authedFetch", () => ({ authedFetch: boundary.mint }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import BeenCardShare from "@/components/profile/BeenCardShare";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  boundary.mint.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it.each([true, false])("reuses a refused link on a fresh tap with Web Share %s", async (webShare) => {
  let tapping = false;
  let sharedUrl: string | null = null;
  let copiedText: string | null = null;
  const path = "/u/sam/been/signed-card";
  const share = (input: { url: string }) => {
    if (!tapping) return Promise.reject(new DOMException("Activation expired", "NotAllowedError"));
    sharedUrl = input.url;
    return Promise.resolve();
  };
  const writeText = (text: string) => {
    if (!tapping) return Promise.reject(new DOMException("Activation expired", "NotAllowedError"));
    copiedText = text;
    return Promise.resolve();
  };
  vi.stubGlobal("navigator", { ...(webShare ? { share } : {}), clipboard: { writeText } });
  let finishMint: (response: Response) => void = () => { throw new Error("No mint request"); };
  boundary.mint.mockImplementation(() => new Promise<Response>((resolve) => { finishMint = resolve; }));
  await act(async () => root.render(createElement(BeenCardShare, { handle: "sam", count: 5 })));
  const button = container.querySelector("button");
  expect(button?.disabled).toBe(false);

  await act(async () => {
    tapping = true;
    button?.click();
    tapping = false;
  });
  await act(async () => finishMint(Response.json({ path, pubs: 5 })));
  expect(sharedUrl).toBeNull();
  expect(copiedText).toBeNull();
  expect(button?.disabled).toBe(false);

  await act(async () => {
    tapping = true;
    button?.click();
    tapping = false;
  });
  expect(boundary.mint).toHaveBeenCalledTimes(1);
  if (webShare) {
    expect(sharedUrl).toBe(new URL(path, window.location.origin).toString());
  } else {
    expect(copiedText).toBe(`I've been to 5 pubs. My Been card on PUBMAXX. ${new URL(path, window.location.origin)}`);
  }
});
