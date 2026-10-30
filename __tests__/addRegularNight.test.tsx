// @vitest-environment jsdom

// "Know a regular night here? Add it" (E4): the form's choices, the sign-in
// gate line, and the receipt.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());

vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => {
    const { user, loading } = authState.current as { user: unknown; loading: boolean };
    const phase = user ? "signed-in" : loading ? "unresolved" : "signed-out";
    return { phase, signedIn: phase === "signed-in", signedOut: phase === "signed-out", unresolved: phase === "unresolved" };
  },
}));
vi.mock("@/components/auth/SignInButton", () => ({
  default: () => createElement("button", { type: "button" }, "Sign in"),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (url: string, init?: RequestInit) => fetchMock(url, init),
  publishAuthActionState: () => {},
}));

import AddRegularNight from "@/components/tonight/AddRegularNight";
import {
  REGULAR_NIGHT_REPORT_INVITE,
  REGULAR_NIGHT_REPORT_KIND_CHOICES,
  REGULAR_NIGHT_REPORT_RECEIPT,
  REGULAR_NIGHT_REPORT_SIGN_IN_LINE,
} from "@/lib/regularNightReports";

let container: HTMLDivElement;
let root: Root | null = null;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(props: { venueId?: string; venueName?: string } = { venueId: "venue-crown", venueName: "The Crown" }) {
  await act(async () => {
    root?.render(createElement(AddRegularNight, { where: "pub", ...props }));
  });
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!found) throw new Error(`no button "${label}" in ${container.innerHTML}`);
  return found;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
  await settle();
}

function select(label: string): HTMLSelectElement {
  const found = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent === label);
  const id = found?.getAttribute("for");
  const element = id ? container.querySelector<HTMLSelectElement>(`#${CSS.escape(id)}`) : null;
  if (!element) throw new Error(`no field "${label}" in ${container.innerHTML}`);
  return element;
}

async function choose(element: HTMLSelectElement | HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.current = { user: { id: "user-a" }, loading: false };
  fetchMock.mockReset();
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
});

describe("AddRegularNight", () => {
  it("opens from its invitation into the kinds, the week and a required photo", async () => {
    await render();
    await click(button(REGULAR_NIGHT_REPORT_INVITE));

    const kinds = [...select("What night").options].map((option) => option.textContent);
    expect(kinds).toEqual(["Choose one", ...REGULAR_NIGHT_REPORT_KIND_CHOICES.map((choice) => choice.label)]);
    const days = [...select("Every").options].map((option) => option.textContent);
    expect(days).toEqual(["Choose a day", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
    expect(container.querySelector('input[type="time"]')).not.toBeNull();
    const file = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(file?.getAttribute("aria-required")).toBe("true");
    expect(container.textContent).toContain("A regular night at The Crown");
  });

  it("shows the sign-in gate line to a signed-out reader and sends nothing", async () => {
    authState.current = { user: null, loading: false };
    await render();
    await click(button(REGULAR_NIGHT_REPORT_INVITE));
    expect(container.textContent).toContain(REGULAR_NIGHT_REPORT_SIGN_IN_LINE);
    expect(button("Sign in")).toBeTruthy();
    expect(container.querySelector("select")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the pub on Tonight, where none is known", async () => {
    await render({});
    await click(button(REGULAR_NIGHT_REPORT_INVITE));
    expect(container.textContent).toContain("Which pub");
  });

  it("refuses to send without a photo, then sends the form and shows the receipt", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ report: { id: "r1", status: "open" } }), { status: 201 }));
    await render();
    await click(button(REGULAR_NIGHT_REPORT_INVITE));
    await choose(select("What night"), "quiz");
    await choose(select("Every"), "2");

    await click(button("Send"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Add a photo of the board or the poster.");

    const file = container.querySelector<HTMLInputElement>('input[type="file"]');
    const board = new File([new Uint8Array([1, 2, 3])], "board.jpg", { type: "image/jpeg" });
    await act(async () => {
      Object.defineProperty(file, "files", { value: [board], configurable: true });
      file?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(button("Send"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/regular-nights");
    const body = init?.body as FormData;
    expect(body.get("venueId")).toBe("venue-crown");
    expect(body.get("kind")).toBe("quiz");
    expect(body.get("weekday")).toBe("2");
    expect(body.get("photo")).toBeInstanceOf(File);
    expect(container.textContent).toContain(REGULAR_NIGHT_REPORT_RECEIPT);
  });
});
