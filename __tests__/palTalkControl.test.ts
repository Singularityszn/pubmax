// @vitest-environment jsdom

import { act, createElement, type ChangeEvent, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PalTalkControl from "@/components/pal/PalTalkControl";
import type {
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
} from "@/lib/pintDropSpeech";

class FakeRecognition implements SpeechRecognitionLike {
  static latest: FakeRecognition | null = null;

  lang = "";
  interimResults = true;
  continuous = true;
  start = vi.fn();
  stop = vi.fn();
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;

  constructor() {
    FakeRecognition.latest = this;
  }
}

function Harness() {
  const [value, setValue] = useState("");
  return createElement(
    "div",
    null,
    createElement("input", {
      "aria-label": "Message",
      value,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.currentTarget.value),
    }),
    createElement(PalTalkControl, { disabled: false, onChange: setValue }),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

let root: Root | null;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "SpeechRecognition", {
    configurable: true,
    value: FakeRecognition,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  FakeRecognition.latest = null;
});

describe("PalTalkControl", () => {
  it("starts recognition only after a click and fills the editable message", async () => {
    await act(async () => root?.render(createElement(Harness)));
    await settle();

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Speak your question");
    expect(button?.style.minHeight).toBe("44px");
    expect(FakeRecognition.latest).toBeNull();

    await act(async () => button?.click());
    const recognition = FakeRecognition.latest;
    expect(recognition?.start).toHaveBeenCalledOnce();
    expect(recognition?.lang).toBe("en-GB");
    expect(recognition?.continuous).toBe(false);
    expect(button?.textContent).toBe("Stop listening");

    await act(async () => {
      recognition?.onresult?.({
        resultIndex: 0,
        results: [{ 0: { transcript: "cheap pint near Soho" }, isFinal: true }],
      } satisfies SpeechRecognitionEventLike);
    });

    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(
      "cheap pint near Soho",
    );
    expect(recognition?.stop).toHaveBeenCalledOnce();
    expect(button?.textContent).toBe("Speak your question");
  });

  it("stops recognition on failure and keeps typing available", async () => {
    await act(async () => root?.render(createElement(Harness)));
    await settle();
    const button = container.querySelector<HTMLButtonElement>("button");
    await act(async () => button?.click());
    const recognition = FakeRecognition.latest;

    await act(async () => recognition?.onerror?.());

    expect(recognition?.stop).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Type instead");
    expect(button?.disabled).toBe(false);
  });

  it("stops active recognition when the control unmounts", async () => {
    await act(async () => root?.render(createElement(Harness)));
    await settle();
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    const recognition = FakeRecognition.latest;

    act(() => root?.unmount());
    root = null;

    expect(recognition?.stop).toHaveBeenCalledOnce();
  });

  it("lets the user stop an active recognition session", async () => {
    await act(async () => root?.render(createElement(Harness)));
    await settle();
    const button = container.querySelector<HTMLButtonElement>("button");
    await act(async () => button?.click());
    const recognition = FakeRecognition.latest;

    expect(button?.textContent).toBe("Stop listening");
    await act(async () => button?.click());

    expect(recognition?.stop).toHaveBeenCalledOnce();
    expect(button?.textContent).toBe("Speak your question");
  });

  it("stops recognition when submission disables the control", async () => {
    const onChange = vi.fn();
    await act(async () => root?.render(createElement(PalTalkControl, {
      disabled: false,
      onChange,
    })));
    await settle();
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    const recognition = FakeRecognition.latest;

    await act(async () => root?.render(createElement(PalTalkControl, {
      disabled: true,
      onChange,
    })));
    await settle();

    expect(recognition?.stop).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  });
});
