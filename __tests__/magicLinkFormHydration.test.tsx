// @vitest-environment jsdom

import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import MagicLinkForm from "@/components/auth/MagicLinkForm";

// /login server-renders the email door, so a reader can type into the field
// before the page hydrates. Only a real hydration shows whether that address
// survives the first render after it.

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

function form(hasSocialProviders: boolean) {
  return createElement(MagicLinkForm, {
    disabled: false,
    hasSocialProviders,
    signInWithEmail: vi.fn(async () => ({ status: "sent" as const, message: "" })),
    cancelAuthAttempt: vi.fn(),
  });
}

it("keeps an email typed into the server-rendered field before hydration", () => {
  host.innerHTML = renderToString(form(false));
  const input = host.querySelector("input") as HTMLInputElement;
  input.value = "guest@example.test";

  act(() => {
    root = hydrateRoot(host, form(false));
  });
  // Any later render, such as the auth client answering, must not reset it.
  act(() => root!.render(form(true)));

  expect(host.querySelector("input")).toBe(input);
  expect(input.value).toBe("guest@example.test");
  expect((host.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
});
