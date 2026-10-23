// @vitest-environment jsdom

// The hidden-name switch is on a new post only. Turning it on makes the post
// public and puts away the pub picker, its score and photo tags, because each
// would name the author. An edit shows the choice and cannot move it.

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HIDDEN_NAME_OWN_LINE, HIDDEN_NAME_TOGGLE_LABEL } from "@/lib/socialHiddenName";
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
  const match = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return match;
}

function setBody(host: HTMLElement, value: string): void {
  const field = host.querySelector("textarea");
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

function hiddenNameSwitch(): HTMLInputElement {
  const label = [...host.querySelectorAll("label")].find((candidate) =>
    (candidate.textContent ?? "").includes(HIDDEN_NAME_TOGGLE_LABEL));
  const input = label?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error("Hidden-name switch not found");
  return input;
}

function labels(): string[] {
  return [...host.querySelectorAll("label")].map((label) => label.textContent ?? "");
}

describe("Social composer hidden-name switch", () => {
  it("sends a public, pub-free post with the name hidden", async () => {
    transport.authedActionJson.mockResolvedValueOnce({
      response: json({ post: { ...POST, nameHidden: true, visibility: "public" } }, 201),
      body: { post: { ...POST, nameHidden: true, visibility: "public" } },
    });
    await mount({});
    await act(async () => {
      button(host, "New post").click();
    });
    expect(labels().some((text) => text.startsWith("Venue"))).toBe(true);
    await act(async () => {
      hiddenNameSwitch().click();
    });
    expect(hiddenNameSwitch().checked).toBe(true);
    expect(labels().some((text) => text.startsWith("Venue"))).toBe(false);
    const visibility = [...host.querySelectorAll("select")].find((select) =>
      select.closest("label")?.textContent?.startsWith("Visibility"));
    expect(visibility?.value).toBe("public");
    expect(visibility?.disabled).toBe(true);

    await act(async () => {
      setBody(host, "Who keeps nicking the good stools");
    });
    await act(async () => {
      button(host, "Post").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const [, init] = transport.authedActionJson.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ nameHidden: true, visibility: "public", venueId: null });
  });

  it("sends no flag at all for an ordinary post", async () => {
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
    expect(JSON.parse(init.body)).not.toHaveProperty("nameHidden");
  });

  it("shows the choice on an edit and offers no way to change it", async () => {
    await mount({ post: { ...POST, nameHidden: true, visibility: "public" } });
    await act(async () => {
      button(host, "Edit post").click();
    });
    expect(host.textContent).toContain(HIDDEN_NAME_OWN_LINE);
    expect(labels().some((text) => text.includes(HIDDEN_NAME_TOGGLE_LABEL))).toBe(false);
    expect(labels().some((text) => text.startsWith("Venue"))).toBe(false);
  });
});
