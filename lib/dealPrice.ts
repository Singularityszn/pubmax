import { validateCommunityPrice } from "@/lib/communityPrice";
import { parseDealSchedule, type DealSchedule } from "@/lib/dealSchedule";
import { cleanDrinkMeasureLabel, statedDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import type { DrinkCategory } from "@/lib/drinks";

export type DealPriceInput = {
  venueId: string;
  drinkCategory: DrinkCategory;
  drink: string;
  measure: DrinkMeasure;
  measureLabel: string;
  priceGbp: number;
  schedule: DealSchedule;
  endDate: string | null;
  conditions: string;
};

export type DealPrice = DealPriceInput & { id: string; reportedAt: string };

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateDealPrice(raw: unknown): { ok: true; value: DealPriceInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Add the deal details." };
  const input = raw as Record<string, unknown>;
  const price = validateCommunityPrice(input);
  if (!price.ok) return price;
  const schedule = parseDealSchedule(input.schedule);
  if (!schedule) return { ok: false, error: "Add the days and times for the deal." };
  const drink = cleanText(input.drink);
  if (!drink || drink.length > 100) return { ok: false, error: "Name the drink in 100 characters or fewer." };
  const measure = statedDrinkMeasure(input.measure);
  if (!measure) return { ok: false, error: "Choose the serving size." };
  const measureLabel = measure === "other" ? cleanDrinkMeasureLabel(input.measureLabel) : "";
  if (measure === "other" && !measureLabel) return { ok: false, error: "Name the serving size." };
  const conditions = cleanText(input.conditions);
  if (conditions.length > 200) return { ok: false, error: "Use 200 characters or fewer for conditions." };
  const endDate = input.endDate === null || input.endDate === undefined || input.endDate === "" ? null : input.endDate;
  if (endDate !== null && (typeof endDate !== "string" || !validDate(endDate))) return { ok: false, error: "Enter a valid end date." };
  return { ok: true, value: { ...price.value, drink, measure, measureLabel, schedule, endDate, conditions } };
}
