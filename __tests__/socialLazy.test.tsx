// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { socialLazy } from "@/app/social/SocialLazy";

afterEach(() => { vi.restoreAllMocks(); });

it("keeps Social usable while a tool loads and retries a rejected import", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let reject!: (error: Error) => void;
  const held = new Promise<{ default: () => React.JSX.Element }>((_, fail) => { reject = fail; });
  const load = vi.fn()
    .mockReturnValueOnce(held)
    .mockResolvedValueOnce({ default: () => <button type="button">Post</button> });
  const Tool = socialLazy(load, "Post controls", <button disabled>Loading post controls…</button>);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => { root.render(createElement("div", null, <p>Plan a night</p>, <Tool />)); });
    expect(host.textContent).toContain("Plan a night");
    expect(host.querySelector("button")?.disabled).toBe(true);
    expect(host.textContent).toContain("Loading post controls");
    await act(async () => { reject(new Error("chunk unavailable")); await held.catch(() => {}); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Post controls could not load");
    expect(host.textContent).toContain("Plan a night");
    await act(async () => { host.querySelector("button")!.click(); });
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.querySelector("button")?.textContent).toBe("Post");
    expect(host.querySelector("button")?.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    error.mockRestore();
  }
});
