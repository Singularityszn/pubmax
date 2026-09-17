import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

import styles from "./chip.module.css";

// The look lives in chip.module.css, outside every cascade layer, for the reason the
// Button primitive states: a layered utility loses to app/globals.css's
// unlayered `button { font: inherit }`. The variants here only compose class
// names. `number` is the square a reader taps a figure on, and it is ONE
// family: the planner's pub-stop count and the /pubs fare-zone picker both
// render it rather than each painting a look-alike square of its own.
const chipVariants = cva("uiChip", {
  variants: {
    variant: {
      pill: "",
      number: "uiChip--number",
    },
  },
  defaultVariants: { variant: "pill" },
});

export interface ChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chipVariants> {}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, variant, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(chipVariants({ variant, className }))}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";

;
