// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>());

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/components/auth/SignInButton", () => ({
  default: () => createElement("button", { type: "button" }, "Sign in"),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: (url: string, init?: RequestInit) => fetchMock(url, init),
  publishAuthActionState: () => {},
}));

import VenueCorrectionDoor from "@/components/map/inspector/VenueCorrectionDoor";

let container: HTMLDivElement;
let root: Root | null = null;
const onLogPrice = vi.fn();

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function render(props: Partial<{ onLogPrice: (() => void) | undefined }> = { onLogPrice }): Promise<void> {
  await act(async () => {
    root?.render(
      createElement(VenueCorrectionDoor, {
        venueId: "venue-crown",
        venueName: "The Crown",
        onLogPrice: props.onLogPrice,
        where: "price",
      }),
    );
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

function choice(label: string): HTMLInputElement {
  const found = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent === label);
  const input = found?.querySelector("input");
  if (!input) throw new Error(`no choice "${label}" in ${container.innerHTML}`);
  return input;
}

function choiceLabels(): string[] {
  return [...container.querySelectorAll(".venueCorrectionChoice")].map((label) => label.textContent ?? "");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  authState.current = { user: { id: "user-a" }, loading: false };
  fetchMock.mockReset();
  onLogPrice.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
});

describe("That's wrong door", () => {
  it("is a quiet text door, not a second price door", async () => {
    await render();
    const door = button("That’s wrong");
    expect(door.className).not.toContain("priceDoor");
    expect(door.hasAttribute("data-price-door")).toBe(false);
    expect(container.textContent).not.toMatch(/—|!/);
  });

  it("opens three choices and the price choice, and posts the one picked with its note", async () => {
    await render();
    await click(button("That’s wrong"));
    expect(choiceLabels()).toEqual(["It's shut", "Hours are wrong", "Price has changed", "Something else"]);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ stored: true }), { status: 201 }));
    await click(choice("It's shut"));
    const note = container.querySelector<HTMLInputElement>(".venueCorrectionNote input");
    expect(note?.maxLength).toBe(200);
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/venue-corrections");
    expect(JSON.parse(String(init?.body))).toEqual({ venueId: "venue-crown", kind: "closed" });
    expect(container.textContent).toContain("Thanks. A person will check it.");
  });

  it("hands a new price to the existing log flow and posts nothing", async () => {
    await render();
    await click(button("That’s wrong"));
    await click(choice("Price has changed"));
    await click(button("Log the new price"));
    expect(onLogPrice).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers only the three choices where no price can be logged", async () => {
    await render({ onLogPrice: undefined });
    await click(button("That’s wrong"));
    expect(choiceLabels()).toEqual(["It's shut", "Hours are wrong", "Something else"]);
  });

  it("shows the sign-in line to a signed-out reader", async () => {
    authState.current = { user: null, loading: false };
    await render();
    await click(button("That’s wrong"));
    expect(container.textContent).toContain("Sign in to contribute.");
    expect(container.querySelector("form")).toBeNull();
  });

  it("says the server's refusal and keeps the form open", async () => {
    await render();
    await click(button("That’s wrong"));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Too many reports, slow down.", code: "RATE_LIMITED" }), { status: 429 }),
    );
    await click(choice("Hours are wrong"));
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
    await settle();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("Too many reports, slow down.");
    expect(container.querySelector("form")).not.toBeNull();
  });
});
