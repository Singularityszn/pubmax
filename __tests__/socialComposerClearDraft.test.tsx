// @vitest-environment jsdom

// Clear draft must stay cleared. The composer writes the draft to storage 300ms
// after the last edit, and Clear draft waits on the photo store before it resets
// the form. A write scheduled before the clear used to fire inside that wait and
// put the text back, so a reload inside the next 300ms restored the cleared
// draft (the two-tab browser spec failed on it, e2e/social-composer.spec.ts).

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const photoStore = vi.hoisted(() => ({
  pending: [] as Array<() => void>,
}));

vi.mock("@/lib/authedFetch", () => ({ authedActionJson: vi.fn() }));

vi.mock("@/lib/socialComposerDrafts", () => ({
  readSocialDraftPhoto: vi.fn(async () => null),
  // Held open until the test lets it finish, like a slow IndexedDB delete.
  saveSocialDraftPhoto: vi.fn(
    () => new Promise<void>((resolve) => photoStore.pending.push(resolve)),
  ),
}));

import SocialComposer from "@/app/social/SocialComposer";

const DRAFT_KEY = "pubmaxx:social-composer:v1:account-a:new";

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = [...host.ownerDocument.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return match;
}

function setBody(host: HTMLElement, value: string): void {
  const field = host.ownerDocument.body.querySelector("textarea");
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("Post body not found");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function settlePhotoStore(): void {
  for (const resolve of photoStore.pending.splice(0)) resolve();
}

let host: HTMLDivElement;
let root: Root | null;

async function mountAndOpen(): Promise<void> {
  await act(async () => {
    root?.render(
      createElement(SocialComposer, { draftScope: "account-a", onSaved: vi.fn() }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    button(host, "New post").click();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  photoStore.pending.length = 0;
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
  it("cancels the pending draft write, so the cleared text does not come back", async () => {
    await mountAndOpen();
    await act(async () => {
      setBody(host, "Alice private draft");
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    settlePhotoStore();
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}")).toMatchObject({
      body: "Alice private draft",
    });

    // An edit schedules a write, and Clear draft lands before it fires.
    await act(async () => {
      setBody(host, "Alice private draft, edited");
    });
    await act(async () => {
      button(host, "Clear draft").click();
      await Promise.resolve();
    });
    // The photo store is still clearing when the old write's 300ms runs out.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();

    await act(async () => {
      settlePhotoStore();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.ownerDocument.body.querySelector("textarea")?.value).toBe("");
    // A reload now, before the cleared draft's own write, finds nothing to restore.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
