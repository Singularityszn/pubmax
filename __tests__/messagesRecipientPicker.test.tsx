// @vitest-environment jsdom

import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {
    user: { id: "user-ken" } as { id: string } | null,
    handle: "ken" as string | null,
    accountRevision: 1,
  },
}));

const requests = vi.hoisted(() => ({
  searchCalls: [] as Array<{
    url: string;
    method: string;
    cache?: RequestCache;
    signal?: AbortSignal;
  }>,
  postCalls: [] as Array<{
    url: string;
    method: string;
    body: string;
    signal?: AbortSignal;
  }>,
  searchRespond: null as
    | ((url: string, init?: RequestInit) => Promise<Response>)
    | null,
  postRespond: null as
    | ((url: string, init?: RequestInit) => Promise<Response>)
    | null,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: "signed-in",
    signedIn: true,
    signedOut: false,
    unresolved: false,
  }),
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    requests.postCalls.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : "",
      signal: init?.signal ?? undefined,
    });
    return (
      requests.postRespond?.(url, init) ??
      Promise.resolve(
        Response.json({ conversationId: "conversation-direct" }, { status: 201 }),
      )
    );
  },
}));

import MessagesNewGroup from "@/components/messages/MessagesNewGroup";
import { RECIPIENT_SEARCH_DEBOUNCE_MS } from "@/components/messages/useMessageRecipientSearch";
import { defined } from "@/__tests__/helpers/defined";

type Recipient = { handle: string; displayName?: string; avatarUrl?: string };
type PickerProps = {
  handle: string;
  onOpened: (conversationId: string) => void;
  open?: boolean;
  onClose?: () => void;
  allowDirect?: boolean;
  suggestedRecipients?: Recipient[];
};

const Picker = MessagesNewGroup as unknown as ComponentType<PickerProps>;

let container: HTMLDivElement;
let root: Root;

async function settle(milliseconds = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function renderPicker(
  props: PickerProps,
  key = "picker",
  create = false,
): Promise<void> {
  if (create) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root.render(createElement(Picker, { ...props, key }));
  });
  await settle();
}

async function mount(overrides: Partial<PickerProps> = {}): Promise<void> {
  await renderPicker(
    {
      handle: "ken",
      onOpened: vi.fn(),
      open: true,
      allowDirect: true,
      ...overrides,
    },
    "picker",
    true,
  );
}

function searchInput(): HTMLInputElement | null {
  const byAria = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search people"]',
  );
  if (byAria) return byAria;
  const label = Array.from(container.querySelectorAll("label")).find(
    (candidate) => candidate.textContent?.trim() === "Search people",
  );
  return label?.htmlFor
    ? document.getElementById(label.htmlFor) as HTMLInputElement | null
    : null;
}

it("renders handle search without keyboard correction or capitalization", async () => {
  await mount();
  const field = searchInput();
  expect(field).not.toBeNull();
  expect(field!.getAttribute("autocapitalize")).toBe("none");
  expect(field!.getAttribute("autocorrect")).toBe("off");
  expect(field!.getAttribute("spellcheck")).toBe("false");
});

function buttonNamed(name: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) =>
        (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() ===
        name,
    ) ?? null
  );
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
    (button) =>
      (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() ===
      name,
  );
}

async function typeInto(field: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  await settle();
}

function postBodies(): unknown[] {
  return requests.postCalls
    .filter((call) => call.method === "POST")
    .map((call) => JSON.parse(call.body) as unknown);
}

beforeEach(() => {
  vi.useFakeTimers();
  requests.searchCalls = [];
  requests.postCalls = [];
  requests.searchRespond = async () =>
    Response.json({
      matches: [{ id: "profile-hari", handle: "hari", displayName: "Hari" }],
    });
  requests.postRespond = null;
  authState.current = {
    user: { id: "user-ken" },
    handle: "ken",
    accountRevision: 1,
  };
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = String(init?.method ?? "GET").toUpperCase();
      requests.searchCalls.push({
        url,
        method,
        cache: init?.cache,
        signal: init?.signal ?? undefined,
      });
      return (
        requests.searchRespond?.(url, init) ??
        Promise.resolve(Response.json({ matches: [] }))
      );
    },
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount());
  }
  container?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("message recipient picker", () => {
  it("searches public profiles, starts a selected direct message, and ignores unselected text", async () => {
    const onOpened = vi.fn();
    await mount({ onOpened });

    expect(container.querySelector('[role="dialog"]')?.textContent ?? "").toContain(
      "New message",
    );
    const search = searchInput();
    expect(search).not.toBeNull();

    await typeInto(search!, "hari");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    expect(
      requests.searchCalls.find((call) => call.method === "GET")?.url,
    ).toBe("/api/profiles/search?q=hari");
    expect(
      requests.searchCalls.find((call) => call.method === "GET")?.cache,
    ).toBe("no-store");
    const addHari = buttonNamed("Add @hari");
    expect(addHari).not.toBeNull();
    await click(addHari!);
    expect(search!.value).toBe("");
    expect(document.activeElement).toBe(search);

    await typeInto(search!, "not-a-recipient");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    const chat = buttonNamed("Chat");
    expect(chat).not.toBeNull();
    await click(chat!);

    expect(postBodies()).toEqual([
      { action: "open", handle: "ken", other: "hari" },
    ]);
    expect(onOpened).toHaveBeenCalledWith("conversation-direct");
  });

  it("opens a group from selected people only and enforces self, dedupe, and the eleven-person cap", async () => {
    const recipients: Recipient[] = Array.from({ length: 12 }, (_, index) => ({
      handle: `person${index + 1}`,
      displayName: `Person ${index + 1}`,
    }));
    recipients.push({ handle: "person1", displayName: "Duplicate Person" });
    const onOpened = vi.fn();
    await mount({
      onOpened,
      suggestedRecipients: [
        { handle: "ken", displayName: "Me" },
        ...recipients,
      ],
    });

    expect(buttonNamed("Add @ken")).toBeNull();
    expect(buttonsNamed("Add @person1")).toHaveLength(1);

    for (let index = 1; index <= 11; index += 1) {
      const handle = `person${index}`;
      const add = buttonNamed(`Add @${handle}`);
      expect(add).not.toBeNull();
      await click(add!);
    }

    const overflow = buttonNamed("Add @person12");
    expect(!overflow || overflow.disabled).toBe(true);
    const createGroup = buttonNamed("Create group");
    expect(createGroup).not.toBeNull();

    const search = searchInput();
    if (search) await typeInto(search, "never-selected");
    await click(createGroup!);

    expect(postBodies()).toEqual([
      {
        action: "open-group",
        handle: "ken",
        participants: recipients.slice(0, 11).map((recipient) => recipient.handle),
      },
    ]);
    expect(onOpened).toHaveBeenCalledWith("conversation-direct");
  });

  it("aborts an old account search and never renders its late response for the next account", async () => {
    const pending: Array<{
      url: string;
      resolve: (response: Response) => void;
      signal?: AbortSignal;
    }> = [];
    requests.searchRespond = (url, init) =>
      new Promise<Response>((resolve) =>
        pending.push({ url, resolve, signal: init?.signal ?? undefined }),
      );

    await mount();
    await typeInto(searchInput()!, "hari");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    expect(pending).toHaveLength(1);

    authState.current = {
      user: { id: "user-lee" },
      handle: "lee",
      accountRevision: 2,
    };
    await renderPicker(
      {
        handle: "lee",
        onOpened: vi.fn(),
        open: true,
        allowDirect: true,
      },
      "picker",
    );
    expect(defined(pending[0]).signal?.aborted).toBe(true);

    await typeInto(searchInput()!, "jane");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    expect(pending).toHaveLength(2);
    await act(async () => {
      defined(pending[1]).resolve(
        Response.json({
          matches: [{ id: "profile-jane", handle: "jane", displayName: "Jane" }],
        }),
      );
    });
    await settle();
    expect(buttonNamed("Add @jane")).not.toBeNull();

    await act(async () => {
      defined(pending[0]).resolve(
        Response.json({
          matches: [{ id: "profile-hari", handle: "hari", displayName: "Hari" }],
        }),
      );
    });
    await settle();
    expect(buttonNamed("Add @hari")).toBeNull();
    expect(buttonNamed("Add @jane")).not.toBeNull();
  });

  it("ignores stale results when same-account search returns to an earlier prefix", async () => {
    const pending: Array<{
      url: string;
      resolve: (response: Response) => void;
      signal?: AbortSignal;
    }> = [];
    requests.searchRespond = (url, init) =>
      new Promise<Response>((resolve) =>
        pending.push({ url, resolve, signal: init?.signal ?? undefined }),
      );

    await mount();
    const search = searchInput()!;
    await typeInto(search, "ha");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    await typeInto(search, "har");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    await typeInto(search, "ha");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    expect(pending).toHaveLength(3);

    await act(async () => {
      defined(pending[2]).resolve(
        Response.json({
          matches: [{ id: "profile-hannah", handle: "hannah", displayName: "Hannah" }],
        }),
      );
    });
    await settle();
    expect(buttonNamed("Add @hannah")).not.toBeNull();

    await act(async () => {
      defined(pending[0]).resolve(
        Response.json({
          matches: [{ id: "profile-harriet", handle: "harriet", displayName: "Harriet" }],
        }),
      );
    });
    await settle();
    await act(async () => {
      defined(pending[1]).resolve(
        Response.json({
          matches: [{ id: "profile-hari", handle: "hari", displayName: "Hari" }],
        }),
      );
    });
    await settle();
    expect(buttonNamed("Add @harriet")).toBeNull();
    expect(buttonNamed("Add @hari")).toBeNull();
    expect(buttonNamed("Add @hannah")).not.toBeNull();
  });

  it("keeps unknown prefixes disabled and retries directory failure without showing an empty result", async () => {
    let searchAttempts = 0;
    requests.searchRespond = async (url) => {
      searchAttempts += 1;
      if (searchAttempts === 1) {
        return Response.json({ error: "directory unavailable" }, { status: 503 });
      }
      const query = new URL(url, "http://local").searchParams.get("q");
      return Response.json({
        matches:
          query === "hari"
            ? [{ id: "profile-hari", handle: "hari", displayName: "Hari" }]
            : [],
      });
    };

    await mount();
    await typeInto(searchInput()!, "hari");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("No people found");
    expect(buttonNamed("Add @hari")).toBeNull();

    await click(buttonNamed("Retry search")!);
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    expect(searchAttempts).toBe(2);
    expect(buttonNamed("Add @hari")).not.toBeNull();

    await typeInto(searchInput()!, "unknown-prefix");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    const chat = buttonNamed("Chat");
    expect(chat).not.toBeNull();
    expect(chat!.disabled || chat!.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
  });

  it("keeps selection after a failed create and permits a deliberate retry", async () => {
    let postAttempts = 0;
    requests.searchRespond = async () =>
      Response.json({
        matches: [{ id: "profile-hari", handle: "hari", displayName: "Hari" }],
      });
    requests.postRespond = async () => {
      postAttempts += 1;
      if (postAttempts === 1) {
        return Response.json({ error: "try again" }, { status: 503 });
      }
      return Response.json({ conversationId: "conversation-retry" }, { status: 201 });
    };
    const onOpened = vi.fn();
    await mount({ onOpened });
    const search = searchInput()!;
    await typeInto(search, "hari");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    await click(buttonNamed("Add @hari")!);
    await click(buttonNamed("Chat")!);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(buttonNamed("Remove @hari")).not.toBeNull();

    await click(buttonNamed("Chat")!);
    expect(postAttempts).toBe(2);
    expect(onOpened).toHaveBeenCalledWith("conversation-retry");
  });

  it("notifies close and aborts an in-flight search", async () => {
    let resolveSearch: ((response: Response) => void) | undefined;
    let searchSignal: AbortSignal | undefined;
    requests.searchRespond = (url, init) =>
      new Promise<Response>((resolve) => {
        if (url.startsWith("/api/profiles/search")) {
          resolveSearch = resolve;
          searchSignal = init?.signal ?? undefined;
        } else {
          resolve(Response.json({ conversationId: "conversation-unused" }));
        }
      });
    const onClose = vi.fn();
    const props: PickerProps = {
      handle: "ken",
      onOpened: vi.fn(),
      onClose,
      open: true,
      allowDirect: true,
    };
    await mount(props);
    await typeInto(searchInput()!, "hari");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    expect(resolveSearch).toBeDefined();

    await click(buttonNamed("Close new message")!);
    expect(onClose).toHaveBeenCalledTimes(1);
    await renderPicker({ ...props, open: false });
    expect(searchSignal?.aborted).toBe(true);
    await act(async () => {
      resolveSearch?.(
        Response.json({
          matches: [{ id: "profile-hari", handle: "hari", displayName: "Hari" }],
        }),
      );
    });
    await settle();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not open a late create result after account changes", async () => {
    let resolveCreate: ((response: Response) => void) | undefined;
    const oldOnOpened = vi.fn();
    const newOnOpened = vi.fn();
    requests.postRespond = () =>
      new Promise<Response>((resolve) => {
        resolveCreate = resolve;
      });

    await mount({ onOpened: oldOnOpened });
    await typeInto(searchInput()!, "hari");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    await click(buttonNamed("Add @hari")!);
    await click(buttonNamed("Chat")!);
    expect(resolveCreate).toBeDefined();

    authState.current = {
      user: { id: "user-lee" },
      handle: "lee",
      accountRevision: 2,
    };
    await renderPicker(
      {
        handle: "lee",
        onOpened: newOnOpened,
        open: true,
        allowDirect: true,
      },
      "picker",
    );
    await act(async () => {
      resolveCreate?.(
        Response.json({ conversationId: "stale-conversation" }, { status: 201 }),
      );
    });
    await settle();

    expect(oldOnOpened).not.toHaveBeenCalled();
    expect(newOnOpened).not.toHaveBeenCalled();
  });

  it("does not open a late create result after the reader cancels", async () => {
    let resolveCreate: ((response: Response) => void) | undefined;
    let createSignal: AbortSignal | undefined;
    const onOpened = vi.fn();
    const onClose = vi.fn();
    requests.postRespond = (_url, init) =>
      new Promise<Response>((resolve) => {
        resolveCreate = resolve;
        createSignal = init?.signal ?? undefined;
      });
    const props: PickerProps = {
      handle: "ken",
      onOpened,
      onClose,
      open: true,
      allowDirect: true,
    };

    await mount(props);
    await typeInto(searchInput()!, "hari");
    await settle(RECIPIENT_SEARCH_DEBOUNCE_MS);
    await click(buttonNamed("Add @hari")!);
    await click(buttonNamed("Chat")!);
    expect(resolveCreate).toBeDefined();

    await click(buttonNamed("Close new message")!);
    expect(onClose).toHaveBeenCalledTimes(1);
    await renderPicker({ ...props, open: false });
    expect(createSignal?.aborted).toBe(true);
    await act(async () => {
      resolveCreate?.(
        Response.json({ conversationId: "cancelled-conversation" }, { status: 201 }),
      );
    });
    await settle();

    expect(onOpened).not.toHaveBeenCalled();
  });
});
