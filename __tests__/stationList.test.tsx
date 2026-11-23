// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import StationList from "@/app/stations/StationList";

describe("station list", () => {
  it("pages the results and searches stations outside the first page", async () => {
    const stations = Array.from({ length: 30 }, (_, index) => ({
      name: `Station ${String(index + 1).padStart(2, "0")}`,
      zone: 1,
      slug: `station-${index + 1}`,
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<StationList stations={stations} />));
    expect(container.textContent).toContain("Station 24");
    expect(container.textContent).not.toContain("Station 25");
    const results = container.querySelector("ul")!.parentElement!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(results, "scrollIntoView", { value: scrollIntoView });
    const next = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Next");
    next!.focus();
    await act(async () => next?.click());
    expect(container.textContent).toContain("Station 25");
    expect(container.textContent).not.toContain("Station 01");
    expect(document.activeElement).toBe(results);
    expect(results.querySelector("a")?.textContent).toBe("Station 25");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    const previous = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Previous")!;
    previous.focus();
    scrollIntoView.mockClear();
    await act(async () => previous.click());
    expect(document.activeElement).toBe(results);
    expect(results.querySelector("a")?.textContent).toBe("Station 01");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    const input = container.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      input.focus();
      setter.call(input, "Station 30");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Station 30");
    expect(container.textContent).not.toContain("Station 25");
    expect(document.activeElement).toBe(input);
    await act(async () => root.unmount());
    container.remove();
  });
});
