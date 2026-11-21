import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "./buttonVariants";
import { ReadyButton } from "@/components/ui/ready-button";


// The look lives in button.css, outside every cascade layer, because a layered
// utility loses to app/globals.css's unlayered `button { font: inherit }`. The
// variants here only compose class names, so there is no utility conflict to
// merge. The site nav draws this button on every route; tailwind-merge stays
// out of that first download.
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : ReadyButton;
    return (
      <Component
        className={buttonVariants({ variant, size, className })}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
