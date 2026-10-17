// @vitest-environment jsdom

// Clear empties the field, so the button unmounts inside the click that
// pressed it, and a browser then hands that click to the label's input as if
// the field had been tapped. On the map toolbar that tap reopened the results
// panel the clear had just closed. Clear keeps its click and puts focus back
// in the field by hand.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SearchField } from "@/components/ui/search-field";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Field({ onInputClick }: { onInputClick: () => void }) {
  const [value, setValue] = useState("Princess Louise");
  return <SearchField value={value} onChange={setValue} onClick={onInputClick} />;
}

it("clears without handing its click to the field, and leaves focus in the field", () => {
  const onInputClick = vi.fn();
  act(() => root.render(<Field onInputClick={onInputClick} />));
  const input = host.querySelector("input")!;
  const clear = host.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!;

  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    clear.dispatchEvent(click);
  });

  expect(input.value).toBe("");
  expect(click.defaultPrevented).toBe(true);
  expect(onInputClick).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  expect(host.querySelector('button[aria-label="Clear search"]')).toBeNull();
});
