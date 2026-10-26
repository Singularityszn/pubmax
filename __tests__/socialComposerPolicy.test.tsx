// @vitest-environment jsdom

// Posts take no comments yet, so the composer offers no Comments setting. The
// stored policy still travels: a new post opens as the default, and an edit
// keeps whatever the post already holds, so the day comments ship nothing has
// been silently rewritten.

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SocialPostDTO } from "@/lib/socialPosts";

const transport = vi.hoisted(() => ({
  authedActionJson: vi.fn(),
}));

vi.mock("@/lib/authedFetch", () => transport);

vi.mock("@/lib/socialComposerDrafts", () => ({
  readSocialDraftPhoto: vi.fn(async () => null),
  saveSocialDraftPhoto: vi.fn(async () => undefined),
}));

import SocialComposer from "@/app/social/SocialComposer";

const POST: SocialPostDTO = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "standard",
  visibility: "friends",
  body: "Keep the policy",
  area: null,
  venueId: null,
  venueProjected: false,
  hashtags: [],
  commentPolicy: "locked",
  nameHidden: false,
  photo: null,
  moderationState: "approved",
  featureRequest: null,
  revision: 1,
  mutationVersion: 1,
  editedAt: null,
  createdAt: "2026-08-30T12:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z",
  author: { handle: "alice" },
  ownedByViewer: true,
  venueName: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

let host: HTMLDivElement;
let root: Root | null;

async function mount(props: { post?: SocialPostDTO; scope?: string }): Promise<void> {
  await act(async () => {
    root?.render(
      createElement(SocialComposer, {
        post: props.post,
        draftScope: props.scope ?? "account-a",
        onSaved: vi.fn(),
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  transport.authedActionJson.mockReset();
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
  vi.restoreAllMocks();
});

describe("Social composer comment policy", () => {
  it("opens outside the page header and blocks background controls until it closes", async () => {
    host.className = "screenPrimary";
    await mount({});
    const trigger = button(host, "New post");
    await act(async () => trigger.click());
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.closest(".screenPrimary")).toBeNull();
    expect(dialog?.parentElement?.parentElement).toBe(document.body);
    expect(host.inert).toBe(true);
    expect(document.documentElement.style.overflow).toBe("hidden");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(host.inert).not.toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(document.documentElement.style.overflow).not.toBe("hidden");
  });

  it("starts a pub recommendation from a prompt without posting it", async () => {
    await mount({});
    await act(async () => button(host, "New post").click());
    await act(async () => button(host, "A pub worth sharing").click());
    expect(host.ownerDocument.body.querySelector("textarea")?.value).toBe("A pub worth sharing: ");
    expect(document.activeElement).toBe(host.ownerDocument.body.querySelector("textarea"));
    expect(transport.authedActionJson).not.toHaveBeenCalled();
    expect(host.ownerDocument.body.textContent).toContain("Only people you follow who follow you back can see this.");
    expect([...host.ownerDocument.body.querySelectorAll("button")].some((item) => item.textContent === "A pub worth sharing")).toBe(false);
  });

  it("explains the chosen audience and preserves a written draft when the composer closes", async () => {
    await mount({});
    await act(async () => button(host, "New post").click());
    await act(async () => setBody(host, "The snug upstairs is worth the stairs."));
    const visibility = [...host.ownerDocument.body.querySelectorAll("label")]
      .find((label) => label.textContent?.startsWith("Visibility"))?.querySelector("select");
    expect(visibility).not.toBeNull();
    await act(async () => {
      visibility!.value = "private";
      visibility!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.ownerDocument.body.textContent).toContain("Only you can see this.");
    await act(async () => button(host, "Cancel").click());
    await act(async () => button(host, "New post").click());
    expect(host.ownerDocument.body.querySelector("textarea")?.value).toBe("The snug upstairs is worth the stairs.");
    expect(host.ownerDocument.body.textContent).toContain("Only you can see this.");
    expect(host.ownerDocument.body.querySelector('[aria-label="Post prompts"]')).toBeNull();
    expect(transport.authedActionJson).not.toHaveBeenCalled();
  });

  it("offers no Comments setting on a new post", async () => {
    await mount({});
    await act(async () => {
      button(host, "New post").click();
    });
    const labels = [...host.ownerDocument.body.querySelectorAll("label")].map((label) => label.textContent ?? "");
    expect(labels.some((text) => text.startsWith("Visibility"))).toBe(true);
    expect(labels.some((text) => text.startsWith("Comments"))).toBe(false);
  });

  it("sends the stored default for a new post", async () => {
    transport.authedActionJson.mockResolvedValueOnce({
      response: json({ post: POST }, 201),
      body: { post: POST },
    });
    await mount({});
    await act(async () => {
      button(host, "New post").click();
    });
    await act(async () => {
      setBody(host, "A quid under the usual");
    });
    await act(async () => {
      button(host, "Post").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const [, init] = transport.authedActionJson.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ commentPolicy: "open" });
  });

  it("keeps the policy an edited post already holds", async () => {
    transport.authedActionJson.mockResolvedValueOnce({
      response: json({ post: POST }),
      body: { post: POST },
    });
    await mount({ post: POST });
    await act(async () => {
      button(host, "Edit post").click();
    });
    expect([...host.ownerDocument.body.querySelectorAll("label")].some((label) => (label.textContent ?? "").startsWith("Comments"))).toBe(false);
    await act(async () => {
      setBody(host, "Keep the policy, new words");
    });
    await act(async () => {
      button(host, "Save").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const [, init] = transport.authedActionJson.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ commentPolicy: "locked" });
  });

  it("drops a comment policy a retired draft still carries", async () => {
    localStorage.setItem(
      "pubmaxx:social-composer:v1:account-a:new",
      JSON.stringify({ body: "Saved before the change", commentPolicy: "friends" }),
    );
    transport.authedActionJson.mockResolvedValueOnce({
      response: json({ post: POST }, 201),
      body: { post: POST },
    });
    await mount({});
    await act(async () => {
      button(host, "New post").click();
    });
    await act(async () => {
      button(host, "Post").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const [, init] = transport.authedActionJson.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ body: "Saved before the change", commentPolicy: "open" });
  });
});
