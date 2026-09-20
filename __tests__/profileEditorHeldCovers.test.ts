// @vitest-environment jsdom

// The editor's view of the covers the PROFILE already holds.
//
// `/u/<handle>?edit=1` opens the editing surface as soon as the viewer's own
// handle resolves, and that is a different read from `GET /api/profiles/<h>`.
// So the editor routinely mounts with no stored row at all and the profile
// arrives a beat later. The held covers are a READ of that row rather than
// something anybody edits here, so they have to follow it: frozen at mount, an
// owner whose profile landed second saw "no cover photo yet" and no Remove
// control for the rest of the session, which is the very bug the prop exists to
// fix. The surrounding text fields are deliberately NOT resynced - that would
// clobber what the owner is typing - so this pins the difference.

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    createElement("img", { src, alt }),
}));

const wire = vi.hoisted(() => ({
  next: async (): Promise<Response> => Response.json({ status: "ready", covers: [] }),
  // Every call the editor made, so a save can be read back field by field.
  calls: [] as Array<{ url: string; init: RequestInit | undefined }>,
}));

vi.mock("@/lib/authedFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authedFetch")>()),
  authedActionFetch: (url: string, init?: RequestInit) => {
    wire.calls.push({ url, init });
    return wire.next();
  },
}));

import ProfileEditor from "@/components/profile/ProfileEditor";
import {
  ACCOUNT_VISIBILITY_COPY,
  type AccountVisibility,
} from "@/lib/accountVisibility";
import {
  PROFILE_COVER_REMOVE_ALL_LABEL,
  profileCoverEmptyLine,
} from "@/lib/profileCovers";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const EMPTY_LINE = profileCoverEmptyLine("ready");
const HELD_COVER = "/api/cover/p1/g1";

let container: HTMLDivElement;
let root: Root | null = null;

type Initial = {
  displayName?: string;
  coverUrl?: string;
  coverUrls?: string[];
  visibility?: AccountVisibility;
};

async function render(initial: Initial): Promise<void> {
  await act(async () => {
    root?.render(
      createElement(ProfileEditor, {
        handle: "alice",
        initial,
        onSaved: () => {},
        onProfileChanged: () => {},
        onClose: () => {},
      }),
    );
  });
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

function removeCoverButton(): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === PROFILE_COVER_REMOVE_ALL_LABEL,
    ) ?? null
  );
}

function mirrorImageSrc(): string | null | undefined {
  return container
    .querySelector(".profileEditorCoverMirrorOnly")
    ?.querySelector("img")
    ?.getAttribute("src");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearSurfaceCache();
  wire.next = async () => Response.json({ status: "ready", covers: [] });
  wire.calls.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.restoreAllMocks();
  clearSurfaceCache();
});

describe("the held covers follow the profile read that lands after the editor opens", () => {
  it("shows the cover and its Remove control once the profile arrives", async () => {
    // The `?edit=1` arrival: identity resolved first, so the stored row is not
    // here yet and every field comes back undefined.
    await render({});
    expect(removeCoverButton(), "nothing is held, so nothing is offered").toBeNull();
    expect(container.textContent).toContain(EMPTY_LINE);

    // The profile read lands. The page stores it and it arrives as this prop.
    await render({ coverUrl: HELD_COVER });

    // THE DEFECT: held in a useState initializer, this stayed `[]` for the life
    // of the session, so an owner with a legacy cover was told they had none and
    // was never offered a way to remove it.
    expect(mirrorImageSrc()).toBe(HELD_COVER);
    expect(removeCoverButton()).not.toBeNull();
    expect(container.textContent).not.toContain(EMPTY_LINE);
  });

  it("follows a later read that took the cover away", async () => {
    await render({ coverUrl: HELD_COVER });
    expect(removeCoverButton()).not.toBeNull();

    await render({});

    expect(mirrorImageSrc()).toBeUndefined();
    expect(removeCoverButton()).toBeNull();
    expect(container.textContent).toContain(EMPTY_LINE);
  });

  it("prefers the rotation over the single back-compat cover", async () => {
    await render({ coverUrl: HELD_COVER, coverUrls: ["/api/cover/p1/g7"] });
    expect(mirrorImageSrc()).toBe("/api/cover/p1/g7");
  });

  it("still leaves an edited text field alone when the read lands late", async () => {
    await render({});
    const field = container.querySelector<HTMLInputElement>("#pe-displayName");
    expect(field, "the display-name field must be mounted").not.toBeNull();

    // React tracks a controlled input's value on the node, so a plain
    // assignment is swallowed. Go through the native setter the way a real
    // keystroke does.
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(field!, "Half typed");
      field!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector<HTMLInputElement>("#pe-displayName")?.value).toBe(
      "Half typed",
    );

    // The same late read that must move the covers must NOT move what somebody
    // is in the middle of typing.
    await render({ displayName: "Stored Name", coverUrl: HELD_COVER });

    expect(
      container.querySelector<HTMLInputElement>("#pe-displayName")?.value,
    ).toBe("Half typed");
    expect(removeCoverButton()).not.toBeNull();
  });
});

function visibilityRadio(choice: AccountVisibility): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(`#pe-visibility-${choice}`);
}

async function save(): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.className === "profileEditorSave",
  );
  expect(button, "the save button must be mounted").toBeDefined();
  await act(async () => {
    button!.click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** The body of the last PATCH the editor sent. */
function lastSavedBody(): Record<string, unknown> {
  const patch = [...wire.calls].reverse().find((call) => call.init?.method === "PATCH");
  expect(patch, "a PATCH must have been sent").toBeDefined();
  return JSON.parse(String(patch!.init!.body)) as Record<string, unknown>;
}

describe("who can see this follows the profile read too, and an untouched control writes nothing", () => {
  it("omits the choice entirely when the read has not answered", async () => {
    // The `?edit=1` arrival again: the editing surface opens on identity, and
    // the stored row is not here. THE DEFECT: the control was snapshot-once, so
    // it opened on the PUBLIC default and then rode every save. An owner who
    // had chosen private and came back to fix a typo was republished by the
    // typo.
    await render({});
    wire.next = async () => Response.json({ profile: null });

    await save();

    expect(
      "visibility" in lastSavedBody(),
      "nothing was chosen and nothing was read, so the column may not be written",
    ).toBe(false);
  });

  it("opens on the stored choice when the read lands after it", async () => {
    await render({});
    expect(visibilityRadio("public")?.checked).toBe(true);

    await render({ visibility: "private" });

    expect(
      visibilityRadio("private")?.checked,
      "the control has to say what the row says, however late the row arrived",
    ).toBe(true);

    wire.next = async () => Response.json({ profile: null });
    await save();
    expect(lastSavedBody().visibility).toBe("private");
  });

  it("keeps an explicit choice when a later read disagrees", async () => {
    await render({ visibility: "private" });
    await act(async () => {
      visibilityRadio("public")!.click();
    });
    expect(visibilityRadio("public")?.checked).toBe(true);

    // The same late read that must move the covers must not undo a decision
    // somebody has just made, exactly as it may not clobber typed text.
    await render({ visibility: "private", coverUrl: HELD_COVER });

    expect(visibilityRadio("public")?.checked).toBe(true);
    wire.next = async () => Response.json({ profile: null });
    await save();
    expect(lastSavedBody().visibility).toBe("public");
  });

  it("prints the boundary about prices beside the choice", async () => {
    await render({});
    expect(container.textContent).toContain(ACCOUNT_VISIBILITY_COPY.pricesStay);
  });
});
