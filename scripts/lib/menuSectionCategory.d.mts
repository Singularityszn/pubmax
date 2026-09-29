export type MenuSectionCategory =
  | "wine"
  | "cocktail"
  | "beer"
  | "whisky"
  | "gin"
  | "vodka"
  | "rum"
  | "shot"
  | "coffee"
  | "alcohol-free"
  | "soft-drink"
  | "other";

export function mapGreeneKingSectionToCategory(section: string): MenuSectionCategory | null;
export function mapMbplcSectionToCategory(section: string): MenuSectionCategory | null;
