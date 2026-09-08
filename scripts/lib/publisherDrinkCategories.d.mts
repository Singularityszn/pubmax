type PublishedDrinkCategory =
  | "beer"
  | "wine"
  | "whisky"
  | "gin"
  | "vodka"
  | "rum"
  | "cocktail"
  | "shot"
  | "alcohol-free"
  | "soft-drink"
  | "coffee";

export function mapGreeneKingSectionToCategory(section: string): PublishedDrinkCategory | null;

export function mapMbplcSectionToCategory(section: string): PublishedDrinkCategory | "other" | null;
