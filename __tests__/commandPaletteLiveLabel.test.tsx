// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const socialLabel = vi.hoisted(() => ({ current: "Social" }));
const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialSurfaceName: () => socialLabel.current,
}));

import CommandPalette from "@/components/command/CommandPalette";
import { storedThemePreference } from "@/lib/themePreference";

const container = document.createElement("div");
const root = createRoot(container);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  socialLabel.current = "Social";
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "ready", photos: [], nextCursor: null })));
  document.body.append(container);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  await act(async () => root.render(null));
  container.remove();
  vi.unstubAllGlobals();
});

it("updates the social command when its live surface name changes", async () => {
  await act(async () => root.render(createElement(CommandPalette, { onClose: vi.fn() })));
  expect(container.querySelector("[id$='-nav-social']")?.textContent).toContain("Social");

  socialLabel.current = "Social preview";
  await act(async () => root.render(createElement(CommandPalette, { onClose: vi.fn() })));
  expect(container.querySelector("[id$='-nav-social']")?.textContent).toContain("Social preview");
});

it("saves the palette's theme toggle where the theme reader looks", async () => {
  document.documentElement.dataset.theme = "light";
  await act(async () => root.render(createElement(CommandPalette, { onClose: vi.fn() })));
  await act(async () => container.querySelector<HTMLElement>("[id$='-action-toggle-theme']")?.click());
  expect(storedThemePreference(window.localStorage)).toBe("dark");
});

it.each(["keyboard", "pointer"])("keeps the %s-selected command when photos arrive", async (selection) => {
  let resolveWall!: (response: Response) => void;
  const wallRead = new Promise<Response>((resolve) => { resolveWall = resolve; });
  vi.stubGlobal("fetch", vi.fn(() => wallRead));
  await act(async () => root.render(createElement(CommandPalette, { onClose: vi.fn() })));
  const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const pal = container.querySelector<HTMLElement>("[id$='-nav-pal']")!;
  expect(container.querySelector("[id$='-nav-wall']")).toBeNull();

  if (selection === "keyboard") {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    }
  } else {
    await act(async () => pal.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })));
  }
  expect(pal.getAttribute("aria-selected")).toBe("true");
  expect(input.getAttribute("aria-activedescendant")).toBe(pal.id);

  await act(async () => {
    resolveWall(Response.json({ status: "ready", photos: [{ id: "photo-1" }], nextCursor: null }));
    await wallRead;
  });
  expect(container.querySelector("[id$='-nav-wall']")).not.toBeNull();
  expect(pal.getAttribute("aria-selected")).toBe("true");
  expect(input.getAttribute("aria-activedescendant")).toBe(pal.id);
  expect(container.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(push).toHaveBeenCalledExactlyOnceWith("/pal");
});

it("moves through the updated list and resets selection when the query changes", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "ready", photos: [{ id: "photo-1" }], nextCursor: null })));
  await act(async () => root.render(createElement(CommandPalette, { onClose: vi.fn() })));
  const input = container.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const key = async (value: string) => {
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
  };
  const selected = () => container.querySelector('[aria-selected="true"]');
  await key("End");
  expect(selected()?.id).toMatch(/-action-toggle-theme$/);
  await key("ArrowDown");
  expect(selected()?.id).toMatch(/-action-toggle-theme$/);
  await key("Home");
  await key("ArrowUp");
  expect(selected()?.id).toMatch(/-nav-map$/);
  for (let i = 0; i < 7; i += 1) await key("ArrowDown");
  expect(selected()?.id).toMatch(/-nav-pal$/);
  await key("ArrowUp");
  expect(selected()?.id).toMatch(/-nav-wall$/);

  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, "zzzzzzzzzz");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await key("ArrowDown");
  await key("Enter");
  expect(selected()).toBeNull();
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  expect(push).not.toHaveBeenCalled();
  await act(async () => {
    setValue.call(input, "Pal");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(selected()?.id).toMatch(/-nav-pal$/);
  await key("Enter");
  expect(push).toHaveBeenCalledExactlyOnceWith("/pal");
});
