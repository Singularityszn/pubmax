import * as React from "react";
import { cva } from "class-variance-authority";

import "./chip.css";

// The look lives in chip.css, outside every cascade layer, for the reason the
// Button primitive states: a layered utility loses to app/globals.css's
// unlayered `button { font: inherit }`. The variants here only compose class
// names. `number` is the square a reader taps a figure on, and it is ONE
// family: the planner's pub-stop count and the /pubs fare-zone picker both
// render it rather than each painting a look-alike square of its own.
export const chipVariants = cva("uiChip", {
  variants: {
    variant: {
      pill: "",
      number: "uiChip--number",
    },
  },
  defaultVariants: { variant: "pill" },
});

/** Render both public entries with the same button, CSS and property forwarding. */
export function renderChip(
  { className, type = "button", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>,
  ref: React.ForwardedRef<HTMLButtonElement>,
): React.JSX.Element {
  return (
    <button
      ref={ref}
      type={type}
      className={className}
      {...props}
    />
  );
}
