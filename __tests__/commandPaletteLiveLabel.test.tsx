// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const socialLabel = vi.hoisted(() => ({ current: "Social" }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialSurfaceName: () => socialLabel.current,
}));

import CommandPalette from "@/components/command/CommandPalette";

const container = document.createElement("div");
const root = createRoot(container);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  socialLabel.current = "Social";
  document.body.append(container);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  await act(async () => root.render(null));
  container.remove();
});

it("updates the social command when its live surface name changes", async () => {
  await act(async () => root.render(createElement(CommandPalette, { onClose: vi.fn() })));
  expect(container.querySelector("[id$='-nav-social']")?.textContent).toContain("Social");

  socialLabel.current = "Social preview";
  await act(async () => root.render(createElement(CommandPalette, { onClose: vi.fn() })));
  expect(container.querySelector("[id$='-nav-social']")?.textContent).toContain("Social preview");
});
