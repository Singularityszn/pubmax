import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

import "./button.css";

// The look lives in button.css, outside every cascade layer, because a layered
// utility loses to app/globals.css's unlayered `button { font: inherit }`. The
// variants here only compose class names.
const buttonVariants = cva("uiButton", {
  variants: {
    variant: {
      primary: "uiButton--primary",
      secondary: "uiButton--secondary",
      ghost: "uiButton--ghost",
      danger: "uiButton--danger",
    },
    size: {
      default: "",
      large: "uiButton--large",
      icon: "uiButton--icon",
    },
  },
  defaultVariants: { variant: "primary", size: "default" },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
