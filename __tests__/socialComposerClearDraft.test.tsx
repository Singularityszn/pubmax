// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const drafts = vi.hoisted(() => ({
  readSocialDraftPhoto: vi.fn(async () => null),
  saveSocialDraftPhoto: vi.fn(async () => undefined),
}));

vi.mock("@/lib/socialComposerDrafts", () => drafts);

import SocialComposer from "@/app/social/SocialComposer";

const DRAFT_KEY = "pubmaxx:social-composer:v1:account-a:new";

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return match;
}

function type(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Social composer Clear draft", () => {
  it("cancels the debounced save that was still pending when the draft was cleared", async () => {
    await act(async () => {
      root?.render(createElement(SocialComposer, { draftScope: "account-a", onSaved: vi.fn() }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      button(host, "New post").click();
    });
    const body = host.querySelector("textarea");
    if (!(body instanceof HTMLTextAreaElement)) throw new Error("Write post field not found");

    await act(async () => {
      type(body, "Alice private draft");
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(localStorage.getItem(DRAFT_KEY)).toContain("Alice private draft");

    // One more edit leaves a save pending, and the photo store answers slowly,
    // so that save comes due while Clear draft is still waiting on it.
    let photoCleared!: () => void;
    drafts.saveSocialDraftPhoto.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => { photoCleared = () => resolve(undefined); }),
    );
    await act(async () => {
      type(body, "Alice private draft, edited");
    });
    await act(async () => {
      button(host, "Clear draft").click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await act(async () => {
      photoCleared();
      await Promise.resolve();
    });

    expect(body.value).toBe("");
    expect(localStorage.getItem(DRAFT_KEY) ?? "").not.toContain("Alice private draft");
  });
});
