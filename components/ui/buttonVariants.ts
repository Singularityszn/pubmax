import { cva } from "class-variance-authority";

export const buttonVariants = cva("uiButton", {
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
