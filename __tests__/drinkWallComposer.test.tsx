// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shell = vi.hoisted(() => ({
  native: false,
  pick: vi.fn(),
}));

vi.mock("@/lib/nativePlatform", () => ({ isNativeApp: () => shell.native }));
vi.mock("@/lib/nativeCamera", () => ({ pickNativePhoto: shell.pick }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: vi.fn() }));
vi.mock("@/components/messages/MessageVenuePicker", () => ({ default: () => null }));
vi.mock("@/components/profile/ProfileImageCropper", () => ({
  default: ({ file }: { file: File }) => createElement("p", { className: "cropping" }, file.name),
}));

import DrinkWallComposer from "@/components/drink-wall/DrinkWallComposer";

let host: HTMLDivElement;
let root: Root;

function choose(): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((node) => node.textContent === "Choose a photo");
  if (!found) throw new Error("no choose button");
  return found as HTMLButtonElement;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(async () => {
  shell.native = false;
  shell.pick.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(DrinkWallComposer, { onCancel: () => {}, onPosted: () => {} }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("choosing a Drink Wall photo", () => {
  it("asks the shell under the venue surface and crops what it hands back", async () => {
    shell.native = true;
    shell.pick.mockResolvedValue({ outcome: "chosen", file: new File(["x"], "venue-1.jpeg") });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click");

    await act(async () => choose().click());
    await flush();

    expect(shell.pick).toHaveBeenCalledWith("venue");
    expect(click).not.toHaveBeenCalled();
    expect(host.querySelector(".cropping")?.textContent).toBe("venue-1.jpeg");
  });

  it("tells the person when the shell has the camera switched off", async () => {
    shell.native = true;
    shell.pick.mockResolvedValue({ outcome: "blocked", message: "Camera access is off for PubMaxxing." });

    await act(async () => choose().click());
    await flush();

    expect(host.querySelector('[role="status"]')?.textContent).toBe("Camera access is off for PubMaxxing.");
  });

  it("says nothing when the person cancels the shell sheet", async () => {
    shell.native = true;
    shell.pick.mockResolvedValue({ outcome: "cancelled" });

    await act(async () => choose().click());
    await flush();

    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector(".cropping")).toBeNull();
  });

  it("opens the web file input off the shell", async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, "click");

    await act(async () => choose().click());
    await flush();

    expect(click).toHaveBeenCalledTimes(1);
    expect(shell.pick).not.toHaveBeenCalled();
  });
});
