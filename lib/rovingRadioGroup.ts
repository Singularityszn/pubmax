import type { KeyboardEvent } from "react";

/**
 * Roving focus for a radiogroup.
 *
 * A radiogroup keeps exactly one option in the tab order, so the arrow keys ARE
 * the only route to the others. Taking the roving `tabIndex` half without this
 * half is worse than taking neither: the unselected options leave the tab order
 * and nothing puts focus back on them, so a keyboard reader cannot reach them at
 * all. One module owns the key policy, because the rule was written out
 * separately for each group and the two would drift.
 */
export function nextRovingIndex(key: string, current: number, total: number): number | null {
  if (total <= 0 || current < 0 || current >= total) return null;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return total - 1;
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % total;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + total) % total;
    default:
      return null;
  }
}

/**
 * Move roving focus inside the group the event was raised on, and take the
 * option there. Selecting on arrow is the radiogroup contract, and in these
 * groups the option is a link, so taking it navigates.
 */
export function handleRovingRadioKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const current = options.indexOf(event.target as HTMLElement);
  const next = nextRovingIndex(event.key, current, options.length);
  if (next === null) return;
  event.preventDefault();
  const option = options[next];
  option?.focus();
  option?.click();
}
