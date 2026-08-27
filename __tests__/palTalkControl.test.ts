// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PalTalkControl from "@/components/pal/PalTalkControl";

const recognitions: FakeRecognition[] = [];
class FakeRecognition {
  lang = "";
  interimResults = true;
  continuous = true;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  constructor() { recognitions.push(this); }
}

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  recognitions.length = 0;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  vi.useRealTimers();
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe("Pal talk control", () => {
  it("starts only after a button press and returns reviewable text", async () => {
    (window as unknown as { webkitSpeechRecognition: typeof FakeRecognition }).webkitSpeechRecognition = FakeRecognition;
    const onTranscript = vi.fn();
    await act(async () => root?.render(createElement(PalTalkControl, { onTranscript })));
    await act(async () => vi.runAllTimers());

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toContain("Speak your question");
    expect(recognitions).toHaveLength(0);
    await act(async () => button?.click());
    expect(recognitions[0]?.start).toHaveBeenCalledOnce();

    await act(async () => recognitions[0]?.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: "cheap pint near Bank" }, isFinal: true }],
    }));
    expect(onTranscript).toHaveBeenCalledWith("cheap pint near Bank");
    expect(container.textContent).toContain("Review the text, then press Ask");
  });
});
