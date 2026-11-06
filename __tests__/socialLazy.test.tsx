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

it.each(["Post controls", "Edit controls", "Your crews", "Your pub ranking", "Tags", "Your posts", "Video"])(
  "preserves focus through held, rejected and retried %s downloads",
  async (label) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let rejectFirst!: (error: Error) => void;
    let rejectSecond!: (error: Error) => void;
    let resolveThird!: (module: { default: () => React.JSX.Element }) => void;
    const first = new Promise((_, reject) => { rejectFirst = reject; });
    const second = new Promise((_, reject) => { rejectSecond = reject; });
    const third = new Promise((resolve) => { resolveThird = resolve; });
    const load = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third);
    const Tool = socialLazy(load, label, <p role="status">Loading {label}</p>);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => { root.render(<><button>Plan a night</button><Tool /></>); });
      const outside = host.querySelector("button")!;
      outside.focus();
      await act(async () => { rejectFirst(new Error("chunk unavailable")); });
      expect(document.activeElement).toBe(outside);
      const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
      retry.focus();
      await act(async () => { retry.click(); });
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement?.textContent).toContain(label);
      expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading");
      await act(async () => { rejectSecond(new Error("still unavailable")); });
      const nextRetry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
      expect(document.activeElement).toBe(nextRetry);
      await act(async () => { nextRetry.click(); });
      expect(document.activeElement).not.toBe(document.body);
      await act(async () => { resolveThird({ default: () => <button>Open tool</button> }); });
      const loaded = [...host.querySelectorAll("button")].find((node) => node.textContent === "Open tool");
      expect(document.activeElement).toBe(loaded);
      expect(outside.isConnected).toBe(true);
      expect(load).toHaveBeenCalledTimes(3);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

it("does not steal focus when the reader leaves a retry during loading", async () => {
  let finish!: (module: { default: () => React.JSX.Element }) => void;
  const load = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const Tool = socialLazy(load, "Tags", <p>Loading tags</p>);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => { root.render(<><button>Plan a night</button><Tool /></>); });
    const outside = host.querySelector("button")!;
    const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
    retry.focus();
    await act(async () => { retry.click(); });
    outside.focus();
    await act(async () => { finish({ default: () => <button>Open tags</button> }); });
    expect(document.activeElement).toBe(outside);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps a named focus position when loaded controls still need preparation", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ default: () => <button disabled>Post</button> });
  const Tool = socialLazy(load, "Post controls", <p>Loading post controls</p>);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => { root.render(<Tool />); });
    const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button')!;
    retry.focus();
    await act(async () => { retry.click(); });
    expect(document.activeElement?.textContent).toBe("Post controls");
    expect(document.activeElement?.parentElement).toBe(host);
    expect(host.querySelector("button")?.textContent).toBe("Post");
    expect(host.querySelector("button")?.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("recovers every instance of a tool when the reader retries one of them", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ default: () => <button>Edit post</button> });
  const Tool = socialLazy(load, "Edit controls", <p>Loading edit controls</p>);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => { root.render(<><Tool /><Tool /></>); });
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
    await act(async () => { host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(); });
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect([...host.querySelectorAll("button")].map((node) => node.textContent)).toEqual(["Edit post", "Edit post"]);
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("draws a tool with no wait when its code arrived before it mounted", async () => {
  const load = vi.fn().mockResolvedValue({ default: () => <button>Rank a pub</button> });
  const Tool = socialLazy(load, "Your pub ranking", <p role="status">Loading your pub ranking</p>);
  await act(async () => { await Tool.preload(); });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    // One synchronous render: no status line is ever committed, so nothing moves.
    act(() => { root.render(<Tool />); });
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector("button")?.textContent).toBe("Rank a pub");
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("draws a later copy with no wait once the first copy has loaded", async () => {
  const load = vi.fn().mockResolvedValue({ default: () => <button>Your crews</button> });
  const Tool = socialLazy(load, "Your crews", <p role="status">Loading your crews</p>);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Tool key="sample" />); });
    expect(host.querySelector("button")?.textContent).toBe("Your crews");
    act(() => { root.render(<Tool key="verified" />); });
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector("button")?.textContent).toBe("Your crews");
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("lets a failed early download fall back to the normal retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const load = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ default: () => <button>Tags</button> });
  const Tool = socialLazy(load, "Tags", <p role="status">Loading tags</p>);
  await act(async () => { await Tool.preload(); });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Tool />); });
    expect(host.querySelector("button")?.textContent).toBe("Tags");
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
